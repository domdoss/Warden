"""First-run GUI setup wizard (PyQt6)."""

from __future__ import annotations

import asyncio
import json
import re
import sys
import webbrowser
from typing import List, Optional

from PyQt6.QtCore import Qt, QSize
from PyQt6.QtGui import QColor, QFont, QIcon, QPalette, QPixmap, QPainter, QPen
from PyQt6.QtWidgets import (
    QApplication,
    QComboBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QVBoxLayout,
    QWidget,
    QWizard,
    QWizardPage,
)

from core.config import Config
from ears.warden_client import WardenAuthError, WardenClient
from ears.session_store import SessionStore


# --- theme -------------------------------------------------------------------

ACCENT = QColor(0, 212, 255)          # cyan, matches the hologram
ACCENT_HOVER = QColor(0, 164, 204)
ACCENT_TEXT = QColor(5, 10, 15)       # dark text reads clearly on bright cyan
FG = QColor(225, 235, 240)
FG_MUTED = QColor(140, 160, 170)
BG = QColor(8, 14, 18)
BG_ELEVATED = QColor(16, 24, 30)
BG_INPUT = QColor(24, 34, 42)
BORDER = QColor(0, 80, 100)


def _apply_theme(app: QApplication) -> None:
    app.setStyle("Fusion")
    pal = QPalette()
    pal.setColor(QPalette.ColorRole.Window, BG)
    pal.setColor(QPalette.ColorRole.WindowText, FG)
    pal.setColor(QPalette.ColorRole.Base, BG_INPUT)
    pal.setColor(QPalette.ColorRole.AlternateBase, BG_ELEVATED)
    pal.setColor(QPalette.ColorRole.ToolTipBase, BG_ELEVATED)
    pal.setColor(QPalette.ColorRole.ToolTipText, FG)
    pal.setColor(QPalette.ColorRole.Text, FG)
    pal.setColor(QPalette.ColorRole.Button, BG_ELEVATED)
    pal.setColor(QPalette.ColorRole.ButtonText, FG)
    pal.setColor(QPalette.ColorRole.Highlight, ACCENT)
    pal.setColor(QPalette.ColorRole.HighlightedText, QColor(255, 255, 255))
    pal.setColor(QPalette.ColorRole.PlaceholderText, FG_MUTED)
    app.setPalette(pal)
    app.setStyleSheet(f"""
        QWizard, QWizardPage, QWidget {{
            background: {BG.name()};
            color: {FG.name()};
            font-size: 11pt;
        }}
        QLabel {{
            color: {FG.name()};
        }}
        QLabel[muted="true"] {{
            color: {FG_MUTED.name()};
            font-size: 10pt;
        }}
        QLineEdit, QComboBox {{
            background: {BG_INPUT.name()};
            color: {FG.name()};
            border: 1px solid {BORDER.name()};
            border-radius: 6px;
            padding: 8px 10px;
            selection-background-color: {ACCENT.name()};
        }}
        QLineEdit:focus, QComboBox:focus {{
            border: 1px solid {ACCENT.name()};
        }}
        QPushButton {{
            background: {ACCENT.name()};
            color: {ACCENT_TEXT.name()};
            border: none;
            border-radius: 6px;
            padding: 8px 18px;
            font-weight: 700;
        }}
        QPushButton:hover {{
            background: {ACCENT_HOVER.name()};
        }}
        QPushButton:disabled {{
            background: {BG_ELEVATED.name()};
            color: {FG_MUTED.name()};
        }}
        QProgressBar {{
            background: {BG_INPUT.name()};
            border: 1px solid {BORDER.name()};
            border-radius: 4px;
            height: 6px;
        }}
        QProgressBar::chunk {{
            background: {ACCENT.name()};
            border-radius: 4px;
        }}
    """)


def _make_logo() -> QPixmap:
    """Tiny red-jarvis mark used as the wizard watermark."""
    pm = QPixmap(96, 96)
    pm.fill(Qt.GlobalColor.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    p.setPen(QPen(ACCENT, 3))
    p.setBrush(QColor(ACCENT.red(), ACCENT.green(), ACCENT.blue(), 80))
    p.drawEllipse(12, 12, 72, 72)
    p.setBrush(QColor(ACCENT.red(), ACCENT.green(), ACCENT.blue(), 160))
    p.drawEllipse(30, 30, 36, 36)
    p.end()
    return pm


def _muted(text: str) -> QLabel:
    lbl = QLabel(text)
    lbl.setProperty("muted", True)
    lbl.setWordWrap(True)
    return lbl


# --- async helper ------------------------------------------------------------

def _run_async(coro):
    """Run a coroutine synchronously on a fresh event loop."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# --- pages -------------------------------------------------------------------

class UrlPage(QWizardPage):
    def __init__(self, config: Config):
        super().__init__()
        self.config = config
        self._token_id = -1
        self._login_id = -1
        self.setTitle("Welcome to your assistant")
        self.setSubTitle("First, where does your Warden server live?")

        self.url = QLineEdit(config.warden.get("base_url") or "https://warden.dev")
        self.url.setPlaceholderText("https://warden.dev")
        self.url.textChanged.connect(self.completeChanged)
        self.registerField("base_url", self.url)

        layout = QVBoxLayout()
        layout.setSpacing(12)
        layout.addWidget(QLabel("Server URL"))
        layout.addWidget(self.url)
        layout.addWidget(_muted("Leave the default unless you're self-hosting."))
        layout.addStretch(1)
        self.setLayout(layout)

    def isComplete(self) -> bool:
        return bool((self.url.text() or "").strip())

    def set_branch(self, token_id: int, login_id: int) -> None:
        self._token_id, self._login_id = token_id, login_id

    @staticmethod
    def _is_local(url: str) -> bool:
        """A local/self-hosted box has no Cloudflare Access in front of it."""
        u = (url or "").strip().lower()
        return (
            u.startswith("http://")
            or "localhost" in u
            or "127.0.0.1" in u
            or "://10." in u
            or "://192.168." in u
            or "://172." in u
        )

    def nextId(self) -> int:
        # Skip the Cloudflare token page when pointing at a local server.
        if self._login_id >= 0 and self._is_local(self.url.text()):
            return self._login_id
        return super().nextId()


class TokenPage(QWizardPage):
    def __init__(self, config: Config):
        super().__init__()
        self.config = config
        self.setTitle("Cloudflare Access")
        self.setSubTitle("Grab a token so this agent can reach the server.")

        self.info = _muted("")
        self.open_btn = QPushButton("Open token page in browser")
        self.open_btn.clicked.connect(self._open)

        self.token = QLineEdit()
        self.token.setPlaceholderText("Paste the token you see in the browser…")
        self.token.setClearButtonEnabled(True)
        # Strip JSON wrapping ({"token":"ey..."}, etc.) on paste so the
        # field always ends up holding the raw JWT.
        self.token.textChanged.connect(self._normalise_token)
        self.registerField("cf_token*", self.token)

        layout = QVBoxLayout()
        layout.setSpacing(12)
        layout.addWidget(self.info)
        layout.addWidget(self.open_btn)
        layout.addSpacing(8)
        layout.addWidget(QLabel("Token"))
        layout.addWidget(self.token)
        layout.addStretch(1)
        self.setLayout(layout)

    def initializePage(self) -> None:
        base = (self.field("base_url") or "").rstrip("/")
        self._url = f"{base}/api/cli-token"
        self.info.setText(
            f"Click the button below to open:\n{self._url}\n\n"
            "Sign in with your Cloudflare-protected account and copy the token it shows."
        )

    def _open(self) -> None:
        try:
            webbrowser.open(self._url)
        except Exception as e:
            QMessageBox.warning(self, "Could not open browser", str(e))

    _JWT_RE = re.compile(r"ey[A-Za-z0-9_\-]+\.ey[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+")

    def _normalise_token(self, text: str) -> None:
        """Best-effort extraction of a JWT from a pasted blob.

        Accepts the raw token, a JSON object like `{"token": "ey..."}` /
        `{"cf_access_token": "ey..."}`, or anything containing a JWT.
        Replaces the field text with just the JWT when one is found.
        """
        stripped = text.strip()
        if not stripped or stripped.startswith("ey") and "." in stripped and "{" not in stripped:
            # Already looks like a bare JWT — leave alone.
            return
        candidate: Optional[str] = None
        # Try JSON first.
        try:
            parsed = json.loads(stripped)
        except (ValueError, TypeError):
            parsed = None
        if isinstance(parsed, dict):
            for key in ("token", "cf_access_token", "cf_token", "access_token", "jwt"):
                v = parsed.get(key)
                if isinstance(v, str):
                    candidate = v.strip()
                    break
            if candidate is None:
                # Fall back to any single string value.
                str_vals = [v for v in parsed.values() if isinstance(v, str)]
                if len(str_vals) == 1:
                    candidate = str_vals[0].strip()
        if candidate is None:
            # Last resort: regex-find a JWT anywhere in the pasted text.
            m = self._JWT_RE.search(stripped)
            if m:
                candidate = m.group(0)
        if candidate and candidate != text:
            # Block the recursive textChanged before replacing.
            self.token.blockSignals(True)
            try:
                self.token.setText(candidate)
            finally:
                self.token.blockSignals(False)


class LoginPage(QWizardPage):
    def __init__(self, config: Config):
        super().__init__()
        self.config = config
        self._ok = False
        self._groups: List[dict] = []

        self.setTitle("Sign in")
        self.setSubTitle("Use your Warden User ID and password.")

        self.username = QLineEdit()
        self.username.setPlaceholderText("user-XXXXXXXXXXXXX-xxxx")
        self.username.setClearButtonEnabled(True)
        self.password = QLineEdit()
        self.password.setPlaceholderText("password")
        self.password.setEchoMode(QLineEdit.EchoMode.Password)

        self.registerField("username*", self.username)
        self.registerField("password*", self.password)

        self.progress = QProgressBar()
        self.progress.setRange(0, 0)
        self.progress.hide()
        self.status = _muted("")

        layout = QVBoxLayout()
        layout.setSpacing(12)
        layout.addWidget(QLabel("User ID"))
        layout.addWidget(self.username)
        layout.addWidget(_muted(
            "Ask your home chat \"what is my user ID?\" and paste the "
            "reply here."
        ))
        layout.addWidget(QLabel("Password"))
        layout.addWidget(self.password)
        layout.addWidget(self.progress)
        layout.addWidget(self.status)
        layout.addStretch(1)
        self.setLayout(layout)

    def validatePage(self) -> bool:
        base_url = self.field("base_url")
        cf_token = self.field("cf_token")
        username = (self.field("username") or "").strip()
        password = self.field("password") or ""
        if not username or not password:
            return False

        self.progress.show()
        self.status.setText("Checking server and signing in…")
        QApplication.processEvents()

        async def do_login():
            store = SessionStore()
            store.clear()
            client = WardenClient(base_url, store, cf_token)
            try:
                await client.health()
                # The user types their canonical user_id directly (server
                # has no non-admin display-name → id lookup, and any
                # unknown id passed to /login creates a ghost user).
                await client.login(username, password)
                groups = await client.list_groups()
                return username, groups
            finally:
                await client.aclose()

        try:
            user_id, groups = _run_async(do_login())
        except WardenAuthError:
            self.progress.hide()
            self.status.setText("Invalid credentials — try again.")
            return False
        except Exception as e:
            self.progress.hide()
            self.status.setText(f"Couldn't connect: {e}")
            QMessageBox.warning(self, "Connection failed", str(e))
            return False

        self.progress.hide()
        self.status.setText(f"Signed in as {username}.")

        self.config.set("warden.base_url", base_url)
        # Only overwrite the saved token when one was supplied (local setup
        # skips the Cloudflare page, so don't wipe an existing cloud token).
        if cf_token:
            self.config.set("warden.cf_access_token", cf_token)
        self.config.set("warden.username", username)
        self.config.set("warden.user_id", user_id)
        self._groups = groups
        # Stash groups on the wizard so the next page can read them.
        self.wizard().setProperty("_groups", groups)
        self._ok = True
        return True


class GroupPage(QWizardPage):
    def __init__(self, config: Config):
        super().__init__()
        self.config = config
        self.setTitle("Pick a default group")
        self.setSubTitle("This is the conversation this agent will drop into.")

        self.combo = QComboBox()

        layout = QVBoxLayout()
        layout.setSpacing(12)
        layout.addWidget(QLabel("Group"))
        layout.addWidget(self.combo)
        layout.addWidget(_muted("You can change this later by re-running setup."))
        layout.addStretch(1)
        self.setLayout(layout)

    def initializePage(self) -> None:
        self.combo.clear()
        groups = self.wizard().property("_groups") or []
        if not groups:
            self.combo.addItem("(no groups returned by server)", "")
            self.combo.setEnabled(False)
            return
        self.combo.setEnabled(True)
        current = self.config.warden.get("default_jid") or ""
        selected = 0
        for i, g in enumerate(groups):
            name = g.get("name") or g.get("folder") or g.get("jid") or "?"
            jid = g.get("jid") or g.get("id") or g.get("_id") or g.get("folder") or ""
            self.combo.addItem(str(name), str(jid))
            if jid == current:
                selected = i
        self.combo.setCurrentIndex(selected)

    def validatePage(self) -> bool:
        jid = self.combo.currentData() or ""
        self.config.set("warden.default_jid", jid)
        self.config.save()
        return True


class ModelPage(QWizardPage):
    def __init__(self, config: Config):
        super().__init__()
        self.config = config
        self.setTitle("Voice model")
        self.setSubTitle("Download the speech-recognition model (one-time).")

        self.status = _muted("")
        self.progress = QProgressBar()
        self.progress.setRange(0, 0)
        self.progress.hide()

        layout = QVBoxLayout()
        layout.setSpacing(12)
        layout.addWidget(self.status)
        layout.addWidget(self.progress)
        layout.addStretch(1)
        self.setLayout(layout)

    def initializePage(self) -> None:
        model_name = self.config.voice.get("whisper_model") or "base"
        self.status.setText(f"Downloading Whisper '{model_name}' — this may take a minute…")
        self.progress.show()
        QApplication.processEvents()
        try:
            import whisper
            whisper.load_model(model_name)
            self.status.setText(f"Whisper '{model_name}' is ready.")
        except Exception as e:
            self.status.setText(f"Download failed: {e}\n\nThis agent will try again on first launch.")
        self.progress.hide()

    def isComplete(self) -> bool:
        return True


class DonePage(QWizardPage):
    def __init__(self):
        super().__init__()
        self.setTitle("You're all set")
        self.setSubTitle("Launch this agent whenever you're ready.")

        body = QLabel(
            "Configuration saved.\n\n"
            "Close this window, then open this agent to start the assistant."
        )
        body.setWordWrap(True)

        layout = QVBoxLayout()
        layout.setSpacing(12)
        layout.addWidget(body)
        layout.addStretch(1)
        self.setLayout(layout)


# --- entrypoint --------------------------------------------------------------

def main() -> int:
    app = QApplication(sys.argv)
    _apply_theme(app)
    app.setFont(QFont("Segoe UI", 10))

    config = Config()

    wizard = QWizard()
    wizard.setWindowTitle("Assistant Setup")
    wizard.setWizardStyle(QWizard.WizardStyle.ModernStyle)
    wizard.setOption(QWizard.WizardOption.NoBackButtonOnStartPage, True)
    wizard.setOption(QWizard.WizardOption.CancelButtonOnLeft, True)
    wizard.setPixmap(QWizard.WizardPixmap.LogoPixmap, _make_logo())

    url_page = UrlPage(config)
    wizard.addPage(url_page)
    token_id = wizard.addPage(TokenPage(config))
    login_id = wizard.addPage(LoginPage(config))
    wizard.addPage(GroupPage(config))
    wizard.addPage(ModelPage(config))
    wizard.addPage(DonePage())
    # Local servers (http/localhost/LAN) have no Cloudflare — skip the token page.
    url_page.set_branch(token_id, login_id)

    wizard.resize(QSize(640, 480))
    wizard.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
