#!/usr/bin/env python3
"""Headless login for the Jarvis frontend.

Creates and stores a Warden session without the Qt setup wizard — handy for the
always-open box. Reads base_url + user_id from config/settings.yaml, prompts for
the password, logs in, and persists the session via SessionStore so `linux.py`
boots straight past its session gate.

    python login.py            # uses warden.user_id from settings.yaml
    python login.py <user_id>  # override the user id
"""

from __future__ import annotations

import asyncio
import getpass
import sys

from core.config import Config
from ears.warden_client import WardenAuthError, WardenClient
from ears.session_store import SessionStore


async def _run(user_id: str, password: str) -> int:
    cfg = Config()
    base_url = cfg.warden.get("base_url") or "https://warden.dev"
    store = SessionStore()
    client = WardenClient(
        base_url=base_url,
        session_store=store,
        cf_access_token=cfg.warden.get("cf_access_token") or None,
    )
    try:
        print(f"[login] server: {base_url}")
        health = await client.health()
        print(f"[login] server health: {health.get('status', '?')}")

        canonical = (await client.login(user_id, password)).get("user_id", user_id)
        print(f"[login] signed in as {canonical}; session stored.")

        groups = await client.list_groups()
        default_jid = cfg.warden.get("default_jid") or ""
        names = ", ".join(g.get("jid", "?") for g in groups[:10]) or "(none)"
        print(f"[login] groups: {names}")
        if default_jid and not any(g.get("jid") == default_jid for g in groups):
            print(
                f"[login] WARNING: default_jid {default_jid!r} not in your groups — "
                "update warden.default_jid in settings.yaml or re-run setup.py."
            )
        return 0
    except WardenAuthError:
        print("[login] FAILED: invalid credentials.")
        return 1
    except Exception as e:
        print(f"[login] FAILED: {e}")
        return 1
    finally:
        await client.aclose()


def main() -> int:
    cfg = Config()
    user_id = sys.argv[1] if len(sys.argv) > 1 else (cfg.warden.get("user_id") or "")
    if not user_id:
        print("No user_id in settings.yaml; pass one: python login.py <user_id>")
        return 2
    password = getpass.getpass(f"Password for {user_id}: ")
    if not password:
        print("No password entered.")
        return 2
    return asyncio.run(_run(user_id, password))


if __name__ == "__main__":
    raise SystemExit(main())
