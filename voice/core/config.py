"""Configuration loader for the Dockbox thin client.

Layered config:
    1. **Bundled defaults** — `config/settings.yaml` shipped inside the exe
       (PyInstaller unpacks to `sys._MEIPASS`). In dev, read from the project
       source tree at `./config/settings.yaml`.
    2. **User overrides** — `%APPDATA%\\Jarvis\\config.yaml` on Windows (or
       `~/.config/jarvis/config.yaml` elsewhere). Written by the setup wizard.

`save()` only ever writes to the user-overrides file — the packaged exe is
never modified. `_load()` reads defaults then deep-merges user overrides on top.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any, Dict

import yaml
from dotenv import load_dotenv


def _bundled_path() -> Path:
    """Location of the shipped defaults."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS) / "config" / "settings.yaml"  # type: ignore[attr-defined]
    return Path("config/settings.yaml")


def _user_path() -> Path:
    """Where per-user overrides get written."""
    appdata = os.environ.get("APPDATA")
    if appdata:
        return Path(appdata) / "Jarvis" / "config.yaml"
    return Path.home() / ".config" / "jarvis" / "config.yaml"


def _deep_merge(base: Dict[str, Any], overlay: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(base)
    for k, v in overlay.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


# Load .env from the bundle when frozen, else from CWD.
if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
    _env_bundle = Path(sys._MEIPASS) / ".env"  # type: ignore[attr-defined]
    if _env_bundle.exists():
        load_dotenv(_env_bundle)
else:
    load_dotenv()


class Config:
    """Application configuration layered from bundled defaults + user overrides."""

    def __init__(self, config_path: Path = None):
        self.bundled_path = _bundled_path()
        # Back-compat: if a caller passes an explicit path, treat it as the
        # user-overrides file (useful in tests / dev).
        self.user_path = Path(config_path) if config_path else _user_path()
        self._data: Dict[str, Any] = {}
        self._load()

    # Alias kept for callers that still reference `config_path` (e.g. the setup
    # wizard prints it on completion).
    @property
    def config_path(self) -> Path:
        return self.user_path

    def _load(self) -> None:
        data: Dict[str, Any] = {}
        if self.bundled_path.exists():
            try:
                data = yaml.safe_load(self.bundled_path.read_text()) or {}
            except Exception:
                data = {}
        if self.user_path.exists():
            try:
                user = yaml.safe_load(self.user_path.read_text()) or {}
                data = _deep_merge(data, user)
            except Exception:
                pass
        self._data = data

    def save(self) -> None:
        self.user_path.parent.mkdir(parents=True, exist_ok=True)
        self.user_path.write_text(yaml.safe_dump(self._data, sort_keys=False))

    def get(self, key: str, default: Any = None) -> Any:
        keys = key.split(".")
        value = self._data
        for k in keys:
            if isinstance(value, dict) and k in value:
                value = value[k]
            else:
                return default
        return value

    def set(self, key: str, value: Any) -> None:
        keys = key.split(".")
        d = self._data
        for k in keys[:-1]:
            d = d.setdefault(k, {})
        d[keys[-1]] = value

    @property
    def voice(self) -> Dict[str, Any]:
        return self._data.get("voice", {})

    @property
    def ui(self) -> Dict[str, Any]:
        return self._data.get("ui", {})

    @property
    def audio(self) -> Dict[str, Any]:
        return self._data.get("audio", {})

    @property
    def dockbox(self) -> Dict[str, Any]:
        return self._data.get("dockbox", {})

    @property
    def conversation(self) -> Dict[str, Any]:
        return self._data.get("conversation", {})
