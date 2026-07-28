"""Async HTTP + SSE client for the Dockbox server."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import AsyncIterator, Optional

import httpx
from httpx_sse import aconnect_sse


class DockboxAuthError(Exception):
    """Raised when the server returns 401/403; UI should re-prompt login."""


class DockboxError(Exception):
    pass


class DockboxClient:
    def __init__(
        self,
        base_url: str,
        session_store,
        cf_access_token: Optional[str] = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.session_store = session_store
        self.cf_access_token = cf_access_token
        cf_headers = {}
        if cf_access_token:
            cf_headers = {
                "cf-access-token": cf_access_token,
                "Cookie": f"CF_Authorization={cf_access_token}",
            }
        self._http = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=30.0,
            follow_redirects=True,
            headers=cf_headers,
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    # ---------- internals ----------

    def _auth_headers(self) -> dict:
        sess = self.session_store.session
        return {"x-user-session": sess} if sess else {}

    def _check_auth(self, resp: httpx.Response) -> None:
        if resp.status_code in (401, 403):
            raise DockboxAuthError(f"Unauthorized ({resp.status_code})")

    async def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        headers = kwargs.pop("headers", {}) or {}
        headers = {**self._auth_headers(), **headers}
        resp = await self._http.request(method, url, headers=headers, **kwargs)
        self._check_auth(resp)
        return resp

    @staticmethod
    def _json(resp: httpx.Response) -> dict:
        try:
            return resp.json()
        except Exception:
            raise DockboxError(f"Non-JSON response from {resp.request.url}: {resp.text[:200]}")

    # ---------- public API: health & users ----------

    async def health(self) -> dict:
        resp = await self._http.get("/api/health")
        return self._json(resp)

    async def list_users(self) -> list[dict]:
        resp = await self._request("GET", "/api/users")
        data = self._json(resp)
        return data if isinstance(data, list) else data.get("users", [])

    async def find_user_by_name(self, username: str) -> Optional[dict]:
        users = await self.list_users()
        target = username.strip().lower()
        for u in users:
            for key in ("name", "username", "display_name"):
                v = u.get(key)
                if v and str(v).strip().lower() == target:
                    return u
        return None

    async def login(self, user_id: str, password: str) -> dict:
        """Log in and persist a session.

        Returns the parsed login response. The route param accepts either
        the display name or the canonical internal id; when given a display
        name, the server's response includes the canonical id under one of
        ``user_id`` / ``id`` / ``userId``. We key the stored session under
        that canonical id so SSE (which subscribes to
        ``/api/users/<canonical>/notifications``) authenticates correctly.
        """
        resp = await self._http.post(
            f"/api/users/{user_id}/login",
            json={"password": password},
        )
        if resp.status_code in (401, 403):
            raise DockboxAuthError("Invalid credentials")
        resp.raise_for_status()
        data = self._json(resp)
        session = data.get("session")
        if not session:
            raise DockboxError(f"Login response missing session: {data}")
        canonical = str(
            data.get("user_id")
            or data.get("id")
            or data.get("userId")
            or user_id
        )
        self.session_store.set(canonical, session)
        data["user_id"] = canonical
        return data

    async def verify(self) -> bool:
        creds = self.session_store.get()
        if not creds:
            return False
        user_id, session = creds
        resp = await self._http.post(
            f"/api/users/{user_id}/verify-session",
            json={"session": session},
        )
        if resp.status_code != 200:
            return False
        return bool(self._json(resp).get("valid"))

    async def logout(self) -> None:
        creds = self.session_store.get()
        if not creds:
            return
        user_id, session = creds
        try:
            await self._http.post(
                f"/api/users/{user_id}/logout",
                json={"session": session},
            )
        finally:
            self.session_store.clear()

    # ---------- groups & messaging ----------

    async def list_groups(self) -> list[dict]:
        resp = await self._request("GET", "/api/groups")
        data = self._json(resp)
        return data if isinstance(data, list) else data.get("groups", [])

    async def send_message(
        self,
        text: str,
        jid: str,
        sender_name: Optional[str] = None,
        model: Optional[str] = None,
    ) -> dict:
        body = {"text": text, "jid": jid}
        if sender_name:
            body["sender_name"] = sender_name
        if model:
            body["model"] = model
        resp = await self._request("POST", "/api/messages", json=body)
        resp.raise_for_status()
        return self._json(resp)

    async def get_messages(self, jid: str, limit: int = 10) -> list[dict]:
        """Recent messages for a chat. The SSE ``chat_complete`` notification
        only carries a truncated preview of the reply; the full ``content`` is
        stored here."""
        resp = await self._request(
            "GET", "/api/messages", params={"jid": jid, "limit": limit}
        )
        resp.raise_for_status()
        data = self._json(resp)
        msgs = data.get("messages") if isinstance(data, dict) else data
        return msgs if isinstance(msgs, list) else []

    async def get_group_folder(self, jid: str) -> Optional[str]:
        """Resolve the on-disk folder name for a group JID (cached).

        Image attachments live at ``<GROUPS_DIR>/<folder>/attachments/`` and are
        referenced relative to the group folder, so we need the folder name to
        upload to the right place.
        """
        if not hasattr(self, "_folder_cache"):
            self._folder_cache: dict[str, str] = {}
        if jid in self._folder_cache:
            return self._folder_cache[jid]
        for g in await self.list_groups():
            gjid = g.get("jid")
            folder = g.get("folder")
            if gjid and folder:
                self._folder_cache[gjid] = folder
        return self._folder_cache.get(jid)

    async def upload_attachment(self, data: bytes, folder: str, filename: str) -> None:
        """Upload raw bytes to ``<folder>/attachments/<filename>``.

        Matches the /api/files/upload handler: dir via ``path`` query param,
        name via the ``x-filename`` header, file as the raw request body.
        """
        resp = await self._request(
            "POST",
            "/api/files/upload",
            params={"path": f"{folder}/attachments"},
            content=data,
            headers={"x-filename": filename},
        )
        resp.raise_for_status()

    async def send_image(
        self,
        image_bytes: bytes,
        jid: str,
        caption: str = "",
        sender_name: Optional[str] = None,
        model: Optional[str] = None,
        ext: str = "png",
    ) -> dict:
        """Upload an image and post a message that references it.

        The server's ``parseImageReferences`` picks up the ``[Image: ...]``
        marker and forwards the image to the vision model.
        """
        import random
        import time

        folder = await self.get_group_folder(jid)
        if not folder:
            raise DockboxError(f"Could not resolve group folder for jid {jid!r}")
        filename = f"img-{int(time.time() * 1000)}-{random.randint(1000, 9999)}.{ext}"
        await self.upload_attachment(image_bytes, folder, filename)
        ref = f"[Image: attachments/{filename}]"
        text = f"{ref} {caption}".strip()
        return await self.send_message(
            text=text, jid=jid, sender_name=sender_name, model=model
        )

    async def upload_voice(
        self,
        audio_bytes: bytes,
        jid: str,
        sender_name: Optional[str] = None,
    ) -> dict:
        params = {"jid": jid}
        if sender_name:
            params["sender_name"] = sender_name
        resp = await self._request(
            "POST",
            "/api/voice",
            params=params,
            content=audio_bytes,
            headers={"Content-Type": "audio/wav"},
        )
        resp.raise_for_status()
        return self._json(resp)

    async def stop_chat(self) -> None:
        await self._request("POST", "/api/chat/stop")

    # ---------- SSE notifications ----------

    async def stream_notifications(self) -> AsyncIterator[dict]:
        # Single-user, no-auth server: notifications are a single global stream
        # at /api/notifications (the old per-user /api/users/<id>/notifications
        # route is gone). No session/user_id required.
        backoff = 1.0
        while True:
            try:
                async with aconnect_sse(
                    self._http,
                    "GET",
                    "/api/notifications",
                    headers=self._auth_headers(),
                    timeout=httpx.Timeout(connect=10.0, read=None, write=10.0, pool=10.0),
                ) as event_source:
                    if event_source.response.status_code in (401, 403):
                        raise DockboxAuthError(
                            f"SSE auth failed: {event_source.response.status_code}"
                        )
                    backoff = 1.0
                    async for sse_event in event_source.aiter_sse():
                        raw = (sse_event.data or "").strip()
                        if not raw:
                            continue
                        try:
                            yield json.loads(raw)
                        except json.JSONDecodeError:
                            yield {"type": "raw", "data": raw}
            except DockboxAuthError:
                raise
            except (httpx.HTTPError, asyncio.IncompleteReadError) as e:
                print(f"[dockbox] SSE disconnected: {e}; reconnecting in {backoff:.1f}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)

    # ---------- files ----------

    async def list_remote_files(self, path: str = "") -> list[dict]:
        resp = await self._request("GET", "/api/files/list", params={"path": path})
        resp.raise_for_status()
        data = self._json(resp)
        return data if isinstance(data, list) else data.get("entries", [])

    async def read_remote_file(self, path: str) -> str:
        resp = await self._request("GET", "/api/files/read", params={"path": path})
        resp.raise_for_status()
        try:
            data = self._json(resp)
            return data.get("content", "")
        except DockboxError:
            return resp.text

    async def download_remote_file(self, path: str) -> bytes:
        resp = await self._request("GET", "/api/files/download", params={"path": path})
        resp.raise_for_status()
        return resp.content

    async def upload_local_file(self, local_path: Path, remote_dir: str = "") -> dict:
        local_path = Path(local_path)
        with local_path.open("rb") as fh:
            files = {"file": (local_path.name, fh, "application/octet-stream")}
            data = {"path": remote_dir} if remote_dir else None
            resp = await self._request("POST", "/api/files/upload", data=data, files=files)
        resp.raise_for_status()
        return self._json(resp)

    async def create_remote_file(self, path: str, content: str) -> dict:
        # Multipart upload of an in-memory file. Server should infer dest from
        # the form path + provided filename.
        remote_dir, _, name = path.rpartition("/")
        if not name:
            name = path
        files = {"file": (name, content.encode("utf-8"), "text/plain")}
        data = {"path": remote_dir} if remote_dir else None
        resp = await self._request("POST", "/api/files/upload", data=data, files=files)
        resp.raise_for_status()
        return self._json(resp)

    async def delete_remote_file(self, path: str) -> dict:
        resp = await self._request("DELETE", "/api/files", params={"path": path})
        resp.raise_for_status()
        try:
            return self._json(resp)
        except DockboxError:
            return {"ok": True}

    async def mkdir_remote(self, path: str) -> dict:
        resp = await self._request("POST", "/api/files/mkdir", json={"path": path})
        resp.raise_for_status()
        return self._json(resp)
