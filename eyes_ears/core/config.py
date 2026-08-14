"""Configuration loader for Eyes & Ears (one config for both apps).

Layered config — ONE file, no shadow configs:
    1. **Bundled defaults** — `config/settings.example.yaml` next to this
       package (resolved via `__file__`, never CWD).
    2. **User overrides** — `config/settings.yaml` next to this package.
       Written by `run.sh` "Configure" / the setup wizard.

`save()` only writes the user-overrides file. `_load()` reads defaults then
deep-merges user overrides on top. Both eyes (detector) and ears (voice) read
the same file via this class.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict

import yaml
from dotenv import load_dotenv


def _package_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _bundled_path() -> Path:
    """Location of the shipped defaults (committed; safe localhost values)."""
    return _package_root() / "config" / "settings.example.yaml"


def _user_path() -> Path:
    """Where per-user overrides get written (gitignored; machine-specific)."""
    return _package_root() / "config" / "settings.yaml"


def _deep_merge(base: Dict[str, Any], overlay: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(base)
    for k, v in overlay.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


# Load .env from CWD if present (optional; harmless if absent).
load_dotenv()


class Config:
    """Application configuration layered from bundled defaults + user overrides."""

    def __init__(self, config_path: Path = None):
        self.bundled_path = _bundled_path()
        # Back-compat: if a caller passes an explicit path, treat it as the
        # user-overrides file (useful in tests / dev / --config overrides).
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

    # ---- section properties (eyes) ----
    @property
    def warden(self) -> Dict[str, Any]:
        return self._data.get("warden", {})

    @property
    def frame_server(self) -> Dict[str, Any]:
        return self._data.get("frame_server", {})

    @property
    def model(self) -> Dict[str, Any]:
        return self._data.get("model", {})

    @property
    def awareness(self) -> Dict[str, Any]:
        return self._data.get("awareness", {})

    # ---- section properties (ears) ----
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
    def conversation(self) -> Dict[str, Any]:
        return self._data.get("conversation", {})

    @property
    def widgets(self) -> Dict[str, Any]:
        return self._data.get("widgets", {})

    @property
    def notes(self) -> Dict[str, Any]:
        return self._data.get("notes", {})

    @property
    def satellite(self) -> Dict[str, Any]:
        return self._data.get("satellite", {})