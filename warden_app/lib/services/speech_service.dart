import 'dart:async';

import 'package:speech_to_text/speech_to_text.dart';

/// Thin wrapper over the platform speech recognizer (tap-to-talk voice input).
/// Deliberately does NOT feed the hologram: the hologram only pulses to the
/// assistant's own voice (TTS), not the user's microphone.
class SpeechService {
  final SpeechToText _stt = SpeechToText();
  bool _ready = false;

  Future<bool> init() async {
    if (_ready) return true;
    _ready = await _stt.initialize();
    return _ready;
  }

  bool get available => _ready;

  /// Listens for a single utterance (up to 30s) and returns the recognized
  /// text, or null if nothing was heard.
  Future<String?> listen() async {
    if (!_ready) {
      final ok = await init();
      if (!ok) return null;
    }
    final completer = Completer<String?>();
    String partial = '';
    try {
      await _stt.listen(
        onResult: (r) {
          partial = r.recognizedWords;
          if (r.finalResult && !completer.isCompleted) {
            completer.complete(r.recognizedWords);
          }
        },
        listenFor: const Duration(seconds: 30),
        pauseFor: const Duration(seconds: 3),
      );
    } catch (_) {
      if (!completer.isCompleted) completer.complete(partial);
    }

    // Important: listen() resolves once listening has *started*, not when it
    // ends. Wait for the actual final result (or fall back to the last partial
    // on timeout), then stop.
    final String? result = await completer.future.timeout(
      const Duration(seconds: 32),
      onTimeout: () => partial,
    );
    try {
      await _stt.stop();
    } catch (_) {}
    return (result != null && result.trim().isNotEmpty) ? result : null;
  }

  Future<void> stop() async {
    try {
      await _stt.stop();
    } catch (_) {}
  }
}
