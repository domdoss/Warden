#!/usr/bin/env python3
"""Steve panel — a big-button window for a blind user, running alongside the
main voice app (in parallel, independent process).

- Big RED button: click → Steve-mode voice turn (VAD record-until-silence via
  the voice app's control server POST /talk?steve=1). The transcript is tagged
  idea="steve" end-to-end, and Warden prepends the Steve-mode instructions to
  the orchestrator's prompt: converse, don't act on rambling.
- Big YELLOW button: flashes while a turn is active; click → POST /cancel,
  which stops any in-flight recording, playback, and turn.
- Blank strip: empty when idle, shows short status text otherwise.

Run with the eyes_ears venv (the voice app's pywebview):

    ./eyes_ears/.venv/bin/python eyes_ears/ptt_button.py [--port 8767]

The ?steve=1 endpoint exists since 2026-09-11 — if the voice app was started
before that, restart it or the button reports "Jarvis is not answering".
"""
import argparse
import json
import os
import urllib.request

import webview  # pywebview, same as the voice app

HERE = os.path.dirname(os.path.abspath(__file__))


class Api:
    """JS bridge. Qt WebEngine blocks fetch() from file:// pages, so the
    HTML talks to the control server through these python calls instead."""

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url

    def _post(self, path: str) -> str:
        try:
            req = urllib.request.Request(self.base_url + path, data=b"", method="POST")
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.read().decode()
        except Exception as e:
            return json.dumps({"ok": False, "error": str(e)})

    def talk(self) -> str:
        # Steve mode: the voice app tags this turn idea="steve".
        return self._post("/talk?steve=1")

    def stop(self) -> str:
        return self._post("/cancel")

    def status(self) -> str:
        try:
            with urllib.request.urlopen(self.base_url + "/status", timeout=5) as resp:
                return resp.read().decode()
        except Exception as e:
            return json.dumps({"ok": False, "error": str(e)})


def main() -> None:
    ap = argparse.ArgumentParser(description="Steve panel — big-button push-to-talk")
    ap.add_argument("--port", type=int, default=8767,
                    help="voice app control-server port (default 8767)")
    ap.add_argument("--host", default="127.0.0.1",
                    help="voice app control-server host (default 127.0.0.1)")
    args = ap.parse_args()

    api = Api(f"http://{args.host}:{args.port}")
    webview.create_window(
        "Steve Panel",
        os.path.join(HERE, "ui", "ptt.html"),
        js_api=api,
        width=420, height=760,
        resizable=True,
        background_color="#050508",
    )
    webview.start()


if __name__ == "__main__":
    main()