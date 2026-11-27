/// Default configuration constants for Dockbox Voice.
///
/// These mirror the defaults in the Python app's config/settings.yaml.
class AppConfig {
  AppConfig._();

  // ---- Server ----
  // Reached over Tailscale (MagicDNS), so Warden is available on the phone from
  // anywhere — not just the LAN. Falls back gracefully; the Settings screen can
  // override this to a LAN IP or a different tailnet node.
  static const String defaultServerUrl = '';
  static const String defaultJid = 'owner@local';
  static const String defaultSenderName = 'Jarvis';

  // ---- Embedded Tailscale (no separate Tailscale app needed) ----
  // The APK ships a userspace Tailscale node (tsnet) plus a localhost proxy:
  // the app talks to http://127.0.0.1:<embeddedProxyPort>, and the node dials
  // the Warden host over the tailnet. Enrollment key is used once; the node
  // identity is then stored in the app's private files dir.
  // Never bake an auth key into source. Supply it via Settings or CI at build
  // time; the interactive "Sign in with Google" flow works without one.
  static const String tailscaleAuthKey = '';
  static const String tailscaleHostname = 'warden-phone';

  static const int embeddedProxyPort = 17800;
  static const String wardenPeerIp = '<tailnet-ip>';
  static const int wardenPeerPort = 3200;

  /// Base URL the app uses once the embedded tunnel is up.
  static const String embeddedServerUrl = 'http://127.0.0.1:$embeddedProxyPort';

  /// Portion of the Warden API used to confirm the tunnel is carrying traffic.
  static const String embeddedHealthPath = '/api/health';

  // ---- Audio ----
  static const int sampleRate = 16000;
  static const double silenceTimeout = 1.0;
  static const double maxRecordingSeconds = 30.0;

  // ---- TTS ----
  static const double ttsSpeed = 0.5; // flutter_tts rate (0.0–1.0, 0.5 = normal)
  static const double ttsPitch = 1.0;

  // ---- UI ----
  static const double defaultWindowWidth = 480;
  static const double defaultWindowHeight = 480;
}
