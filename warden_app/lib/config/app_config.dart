/// Build-time constants for the Warden mobile app.
class AppConfig {
  AppConfig._();

  static const String appName = 'Warden';
  static const String version = '1.0.0';

  // ---- Embedded Tailscale (no separate Tailscale app) ----
  // The APK ships a userspace Tailscale node (tsnet) plus a localhost proxy.
  // Enrollment key is used once; the node identity then persists in the app's
  // private files dir. Users can override the key in Settings.
  // Never bake an auth key into source. Supply it via Settings or CI at build
  // time; the interactive "Sign in with Google" flow works without one.
  static const String tailscaleAuthKey = '';
  static const String tailscaleHostname = 'warden-phone';

  static const int embeddedProxyPort = 17800;
  // The proxy dials the tailnet HTTPS `serve` endpoint (443), not :3200 —
  // Warden only accepts the owner API from loopback/LAN, and `serve` connects
  // to the app server from 127.0.0.1.
  static const String wardenPeerHost = '';
  static const int wardenPeerPort = 443;

  /// Base URL once the embedded tunnel is up.
  static const String embeddedServerUrl = 'http://127.0.0.1:$embeddedProxyPort';

  /// Fallback when the tunnel is not up: the tailnet HTTPS address (works on a
  /// phone that has the Tailscale app installed).
  static const String fallbackServerUrl = '';

  // ---- Chat ----
  static const String senderName = 'Warden';
}
