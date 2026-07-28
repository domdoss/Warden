"""Persisted (user_id, session) for the Dockbox thin client."""

import json
import os
from pathlib import Path
from typing import Optional, Tuple


def _default_path() -> Path:
    """Per-user session file. Windows: %APPDATA%\\Jarvis; else ~/.config/jarvis."""
    appdata = os.environ.get("APPDATA")
    if appdata:
        return Path(appdata) / "Jarvis" / "session.json"
    return Path.home() / ".config" / "jarvis" / "session.json"


_DEFAULT_PATH = _default_path()


class SessionStore:
    def __init__(self, path: Path = None):
        self.path = Path(path) if path else _DEFAULT_PATH

    def get(self) -> Optional[Tuple[str, str]]:
        if not self.path.exists():
            return None
        try:
            data = json.loads(self.path.read_text())
        except (json.JSONDecodeError, OSError):
            return None
        uid, sess = data.get("user_id"), data.get("session")
        if not uid or not sess:
            return None
        return (uid, sess)

    def set(self, user_id: str, session: str) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps({"user_id": user_id, "session": session}))
        try:
            os.chmod(self.path, 0o600)
        except (OSError, NotImplementedError):
            pass

    def clear(self) -> None:
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass

    @property
    def user_id(self) -> Optional[str]:
        v = self.get()
        return v[0] if v else None

    @property
    def session(self) -> Optional[str]:
        v = self.get()
        return v[1] if v else None
