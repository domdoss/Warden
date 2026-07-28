#!/usr/bin/env python3
"""Headless, no-auth setup for the Jarvis frontend.

Points the client at a single local Dockbox server (10.0.0.47:3200) with no
Cloudflare token, no user id, and no password. The server is single-user, so
its one group (``owner@local``) is the default. Verifies the server is
reachable and writes the config so `main.py` boots straight in.

    python single.py
"""

from __future__ import annotations

import asyncio

from core.config import Config
from core.dockbox_client import DockboxClient
from core.session_store import SessionStore


BASE_URL = "http://127.0.0.1:3200"
DEFAULT_JID = "owner@local"


async def _run() -> int:
    cfg = Config()
    store = SessionStore()
    store.clear()
    client = DockboxClient(base_url=BASE_URL, session_store=store)
    try:
        print(f"[single] server: {BASE_URL}")
        health = await client.health()
        print(f"[single] server health: {health.get('status', '?')}")

        cfg.set("dockbox.base_url", BASE_URL)
        cfg.set("dockbox.default_jid", DEFAULT_JID)
        # Drop any leftover auth from a previous (cloud) setup — this server
        # needs none.
        for stale in ("cf_access_token", "user_id", "username"):
            cfg.dockbox.pop(stale, None)
        cfg.save()
        print(f"[single] saved config to {cfg.config_path}")
        print(f"[single] base_url={BASE_URL}  default_jid={DEFAULT_JID}")
        return 0
    except Exception as e:
        print(f"[single] FAILED: {e}")
        return 1
    finally:
        await client.aclose()


def main() -> int:
    return asyncio.run(_run())


if __name__ == "__main__":
    raise SystemExit(main())
