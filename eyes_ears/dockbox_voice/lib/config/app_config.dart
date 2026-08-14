/// Default configuration constants for Dockbox Voice.
///
/// These mirror the defaults in the Python app's config/settings.yaml.
class AppConfig {
  AppConfig._();

  // ---- Server ----
  // Match single.py: no-auth local server
  static const String defaultServerUrl = 'http://10.0.0.47:3200';
  static const String defaultJid = 'owner@local';
  static const String defaultSenderName = 'Jarvis';

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
