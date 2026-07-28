"""Warden awareness client — sends structured situation events as chat messages.

The security detector no longer ships JPEG frames for routine awareness.
Instead it posts compact JSON AWARENESS events to Warden's /api/messages.
Warden routes any message starting with 'AWARENESS' to Sentry (the background
situational-awareness agent), which decides whether to speak to the user.

If a future escalation path is needed, it should be added back as a separate
structured call with a reason, not as an image attachment.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.request
import urllib.error

log = logging.getLogger("security.warden")

AWARENESS_PROMPT = "AWARENESS — {event} at {ts}. data: {data}"


class WardenClient:
    def __init__(self, base_url: str, owner_jid: str):
        self.base_url = base_url.rstrip("/")
        self.owner_jid = owner_jid

    def send_awareness(self, event: str, data: dict) -> dict:
        """POST an AWARENESS event to Warden as a plain chat message.

        `event` is the semantic change type (arrival, departure, movement,
        camera_covered, camera_uncovered, camera_moved, motion_burst, note).
        `data` is the JSON payload for Sentry to reason about.
        """
        ts = str(data.get("ts") or time.strftime("%Y%m%dT%H%M%S"))
        data = dict(data, ts=ts)
        text = AWARENESS_PROMPT.format(
            event=event, ts=ts, data=json.dumps(data, separators=(",", ":")),
        )
        return self._post(text)

    def _post(self, text: str) -> dict:
        """POST a message to Warden.

        AWARENESS events use the dedicated /api/awareness endpoint if available,
        so they never appear in the chat. Falls back to /api/messages for older
        desktops.
        """
        is_awareness = text.startswith("AWARENESS")

        # Try the dedicated awareness endpoint first (no chat, no relay).
        if is_awareness:
            try:
                aware_url = f"{self.base_url}/api/awareness"
                aware_payload = json.dumps({"text": text}, separators=(",", ":")).encode("utf-8")
                req = urllib.request.Request(
                    aware_url, data=aware_payload,
                    headers={"Content-Type": "application/json"}, method="POST",
                )
                with urllib.request.urlopen(req, timeout=5) as resp:
                    body = resp.read().decode("utf-8", "replace")
                    log.info("awareness event routed directly (%s): %s", resp.status, body[:200])
                    return {"ok": True, "status": resp.status}
            except urllib.error.HTTPError as e:
                # 404 = old desktop without /api/awareness; fall through to chat path.
                if e.code != 404:
                    log.warning("awareness endpoint failed (%s), falling back to chat: %s", aware_url, e)
            except Exception as e:
                log.warning("awareness endpoint unreachable, falling back to chat: %s", e)

        # Fallback: store as bot message (hidden from user chat on new desktops).
        payload = json.dumps({
            "jid": self.owner_jid,
            "text": text,
            "is_bot_message": is_awareness,
            "sender_name": "Sentry" if is_awareness else None,
        }, separators=(",", ":")).encode("utf-8")
        url = f"{self.base_url}/api/messages"

        try:
            req = urllib.request.Request(
                url, data=payload,
                headers={"Content-Type": "application/json"}, method="POST",
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                body = resp.read().decode("utf-8", "replace")
                log.info("message sent to Warden (%s): %s", resp.status, body[:200])
                return {"ok": True, "status": resp.status}
        except urllib.error.URLError as e:
            log.warning("Warden unreachable (%s) — event not delivered: %s", url, e)
            return {"ok": False, "error": str(e)}
        except Exception as e:
            log.warning("event POST failed: %s", e)
            return {"ok": False, "error": str(e)}
