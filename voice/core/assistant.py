"""Thin Dockbox bridge — the brain lives on the server.

Replaces the local Ollama/tools-based assistant with a small orchestration layer
that:
  - Sends transcribed text to Dockbox via DockboxClient.send_message.
  - Consumes the SSE notification stream and yields response chunks.

Voice transcription stays local (Whisper); the audio never leaves the device.
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Callable, Optional

from core.config import Config
from core.dockbox_client import DockboxAuthError, DockboxClient
from core.session_store import SessionStore

_STREAM_LOG = Path(__file__).resolve().parent.parent / "agent_stream.log"

# Stray container stdout the server forwards as its own activity lines:
# service-startup banners (``[start-services] ttyd :7681, novnc :6080``) and
# exported env vars (``PORT=5900``). They match none of the tool-loop chrome
# prefixes, so without this they get spoken — as numbers — before the reply.
_CONTAINER_LOG_RE = re.compile(r"^(\[[a-z0-9_-]+\]|[A-Z][A-Z0-9_]*=)")


class DockboxBridge:
    """High-level orchestrator used by ``main.py``."""

    def __init__(self, config: Config):
        self.config = config
        self.session_store = SessionStore()
        self.client = DockboxClient(
            base_url=config.dockbox.get("base_url", "https://dockbox.dev"),
            session_store=self.session_store,
            cf_access_token=config.dockbox.get("cf_access_token") or None,
        )

        self.active_jid: str = config.dockbox.get("default_jid", "") or ""
        self.model: Optional[str] = config.dockbox.get("model") or None

        self._sse_task: Optional[asyncio.Task] = None
        self._on_chunk: Optional[Callable[[str], None]] = None
        self._on_turn_end: Optional[Callable[[], None]] = None
        # ANSI dim escapes wrap the model's reasoning tokens; we forward only
        # non-dim text. State spans events because dim runs can cross chunks.
        self._dim_active: bool = False
        # Tool-result lines (✅/❌/⚠️) are followed by a multi-line JSON dump.
        # Drop everything after a tool-result header until the next
        # ``[agent-runner]`` log line resets us.
        self._in_tool_result: bool = False
        # The model often re-generates the same reply across several tool
        # iterations; the server keeps only the last as the written response.
        # Buffer the current iteration's spoken text and reset it whenever a
        # new iteration begins, so we speak the final response exactly once
        # instead of every intermediate duplicate.
        self._turn_text: list[str] = []
        # The user-facing reply now arrives as a ``chat_complete`` event's
        # ``message`` (e.g. delivered via the model's say_to_user tool). When
        # we've spoken that, suppress the agent_activity tool-loop wrap-up
        # ("The story has been told.") for the same turn.
        self._spoke_message: bool = False

    # ---------- lifecycle ----------

    async def aclose(self) -> None:
        if self._sse_task is not None:
            self._sse_task.cancel()
        await self.client.aclose()

    async def is_logged_in(self) -> bool:
        return await self.client.verify()

    def set_active_jid(self, jid: str) -> None:
        self.active_jid = jid
        self.config.set("dockbox.default_jid", jid)
        self.config.save()

    # ---------- callbacks ----------

    def on_chunk(self, cb: Callable[[str], None]) -> None:
        """Called with each text chunk that arrives over SSE."""
        self._on_chunk = cb

    def on_turn_end(self, cb: Callable[[], None]) -> None:
        """Called when the server marks a turn complete (event type 'done' or 'turn_end')."""
        self._on_turn_end = cb

    # ---------- send ----------

    async def send_text(self, text: str, sender_name: Optional[str] = None) -> dict:
        if not self.active_jid:
            raise RuntimeError("No active JID set; pick a group first.")
        return await self.client.send_message(
            text=text,
            jid=self.active_jid,
            sender_name=sender_name,
            model=self.model,
        )

    async def send_image(
        self,
        image_bytes: bytes,
        caption: str = "",
        sender_name: Optional[str] = None,
        ext: str = "png",
    ) -> dict:
        """Send a captured image (+ optional spoken caption) for vision.

        The reply streams back over SSE exactly like ``send_text``.
        """
        if not self.active_jid:
            raise RuntimeError("No active JID set; pick a group first.")
        return await self.client.send_image(
            image_bytes=image_bytes,
            jid=self.active_jid,
            caption=caption,
            sender_name=sender_name,
            model=self.model,
            ext=ext,
        )

    async def stop(self) -> None:
        try:
            await self.client.stop_chat()
        except Exception as e:
            print(f"[bridge] stop_chat failed: {e}")

    # ---------- SSE consumption ----------

    def start_stream(self) -> None:
        if self._sse_task is None or self._sse_task.done():
            self._sse_task = asyncio.create_task(self._sse_loop())

    async def _sse_loop(self) -> None:
        try:
            async for event in self.client.stream_notifications():
                et = (event.get("type") or "").lower()
                if et not in ("connected", "ping", "keepalive"):
                    if et != "agent_activity":
                        print(f"[bridge] SSE event: {event}")
                await self._handle_event(event)
        except DockboxAuthError as e:
            print(f"[bridge] SSE auth error: {e}")
        except asyncio.CancelledError:
            return
        except Exception as e:
            print(f"[bridge] SSE loop error: {e}")

    async def _handle_event(self, event: dict) -> None:
        et = (event.get("type") or "").lower()
        if et in ("connected", "ping", "keepalive"):
            return
        if et == "agent_activity":
            line = event.get("line") or ""
            try:
                with _STREAM_LOG.open("a", encoding="utf-8") as fh:
                    fh.write(repr(line) + "\n")
            except Exception as e:
                print(f"[bridge] stream log write failed: {e}")
            # A new turn starts a fresh "did we already speak the reply?" state.
            if "Entering tool loop" in line:
                self._spoke_message = False
            # A new tool iteration means the model is regenerating its reply
            # from scratch — drop the previous iteration's buffer so only the
            # final iteration survives to be spoken.
            if "Entering tool loop" in line or "Tool iteration" in line:
                self._turn_text = []
            text = self._filter_agent_line(line)
            if text:
                self._turn_text.append(text)
            # Server doesn't emit done/turn_end — "Query complete" is the
            # de-facto end-of-turn signal.
            if "Query complete" in line or "Exited tool loop" in line:
                self._dim_active = False
                self._in_tool_result = False
                self._finish_turn()
            return
        if et in ("done", "turn_end", "complete", "agent_done", "chat_complete"):
            self._dim_active = False
            self._in_tool_result = False
            # The real user-facing reply rides in ``message`` (say_to_user), but
            # the notification truncates it to a preview — fetch the full stored
            # message and speak that. Mark the turn handled so the agent_activity
            # wrap-up is suppressed.
            preview = (event.get("message") or "").strip()
            if preview:
                self._spoke_message = True
                self._turn_text = []
                full = await self._full_message(preview)
                if self._on_chunk is not None:
                    try:
                        self._on_chunk(full)
                    except Exception as e:
                        print(f"[bridge] on_chunk raised: {e}")
                if self._on_turn_end is not None:
                    try:
                        self._on_turn_end()
                    except Exception as e:
                        print(f"[bridge] on_turn_end raised: {e}")
            else:
                self._finish_turn()
            return

    async def _full_message(self, preview: str) -> str:
        """Resolve a truncated chat_complete preview to the full stored reply.

        The notification cuts the text mid-word, so we match by prefix against
        recent messages and return the complete ``content``. Falls back to the
        preview if nothing matches or the fetch fails.
        """
        head = preview.rstrip("…").rstrip(". ").strip()
        if not head or not self.active_jid:
            return preview
        try:
            msgs = await self.client.get_messages(self.active_jid, limit=10)
        except Exception as e:
            print(f"[bridge] get_messages failed: {e}")
            return preview
        for m in msgs:
            content = (m.get("content") or "").strip()
            if content and content.startswith(head):
                return content
        return preview

    def _finish_turn(self) -> None:
        """Speak the buffered final-iteration text once, then end the turn."""
        spoken = "" if self._spoke_message else "".join(self._turn_text).strip()
        self._turn_text = []
        if spoken and self._on_chunk is not None:
            try:
                self._on_chunk(spoken)
            except Exception as e:
                print(f"[bridge] on_chunk raised: {e}")
        if self._on_turn_end is not None:
            try:
                self._on_turn_end()
            except Exception as e:
                print(f"[bridge] on_turn_end raised: {e}")

    def _filter_agent_line(self, line: str) -> str:
        """Filter an agent_activity line down to spoken response text.

        Drops:
          - ``[agent-runner] ...`` internal logs
          - ``🤔 ... is generating``, separators, ``🔧 Tool calls`` headers,
            ``  → tool_name`` lists
          - ``✅``/``❌``/``⚠️`` tool-result headers AND the multi-line JSON
            payload that follows them (state tracked until the next
            ``[agent-runner]`` line)
          - Reasoning wrapped in ANSI dim escapes ``\\x1b[2m ... \\x1b[0m``
          - Truncated raw JSON fragments that occasionally leak as their
            own activity line
        """
        if line.startswith("[agent-runner]"):
            self._in_tool_result = False
            return ""
        if self._in_tool_result:
            return ""
        if line.startswith('{"model"') or line.startswith('{"id"') or line.startswith('{"role"'):
            return ""
        # Tool-loop chrome is emitted with varying indentation (headers flush
        # left, tool lists/results indented two spaces), so match on the
        # stripped line — otherwise an indented ✅ result header slips past and
        # gets spoken along with its multi-line payload.
        stripped = line.lstrip()
        if stripped.startswith("🤔") or stripped.startswith("────") or stripped.startswith("🔧"):
            return ""
        if stripped.startswith("→"):
            return ""
        if stripped.startswith("✅") or stripped.startswith("❌") or stripped.startswith("⚠️"):
            self._in_tool_result = True
            return ""
        if _CONTAINER_LOG_RE.match(stripped):
            return ""

        out: list[str] = []
        pos = 0
        while pos < len(line):
            esc = line.find("\x1b", pos)
            if esc < 0:
                if not self._dim_active:
                    out.append(line[pos:])
                break
            if esc > pos and not self._dim_active:
                out.append(line[pos:esc])
            end = line.find("m", esc)
            if end < 0:
                break
            code = line[esc:end + 1]
            if code == "\x1b[2m":
                self._dim_active = True
            elif code == "\x1b[0m":
                self._dim_active = False
            pos = end + 1
        return "".join(out)
