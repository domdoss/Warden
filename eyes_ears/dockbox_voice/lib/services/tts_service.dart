import 'dart:async';

import 'package:flutter_tts/flutter_tts.dart';

import '../config/app_config.dart';

/// Wraps Android's built-in TextToSpeech engine.
///
/// Replaces the Python app's local Kokoro TTS.
class TtsService {
  final FlutterTts _tts = FlutterTts();

  final _audioLevelController = StreamController<double>.broadcast();
  Stream<double> get audioLevelStream => _audioLevelController.stream;

  bool _initialized = false;
  Timer? _levelTimer;

  Future<void> initialize() async {
    if (_initialized) return;
    await _tts.setLanguage('en-US');
    await _tts.setSpeechRate(AppConfig.ttsSpeed);
    await _tts.setPitch(AppConfig.ttsPitch);
    _initialized = true;
  }

  /// Speak the given text. Returns a future that completes when speech finishes.
  Future<void> speak(String text) async {
    if (!_initialized) await initialize();
    if (text.trim().isEmpty) return;

    _startSimulatedAudioLevel(text);

    await _tts.speak(text);

    _stopSimulatedAudioLevel();
    _audioLevelController.add(0.0);
  }

  /// Cancel any ongoing speech immediately.
  Future<void> stop() async {
    _stopSimulatedAudioLevel();
    _audioLevelController.add(0.0);
    await _tts.stop();
  }

  void _startSimulatedAudioLevel(String text) {
    _stopSimulatedAudioLevel();
    // Estimate duration: ~150 words/min, ~5 chars/word
    final estimatedMs = ((text.length / 5) * (60000 / 150)).toInt().clamp(500, 30000);
    final steps = (estimatedMs / 50).toInt().clamp(10, 600);
    int step = 0;

    _levelTimer = Timer.periodic(const Duration(milliseconds: 50), (timer) {
      if (step >= steps) {
        timer.cancel();
        _audioLevelController.add(0.0);
        return;
      }
      // Pulse wave: rises and falls
      final phase = step / steps;
      final level = (phase < 0.5)
          ? phase * 2 * 1.5 // ramp up to 1.5
          : (1.0 - phase) * 2 * 1.5; // ramp down
      _audioLevelController.add(level.clamp(0.0, 2.0));
      step++;
    });
  }

  void _stopSimulatedAudioLevel() {
    _levelTimer?.cancel();
    _levelTimer = null;
  }

  void dispose() {
    _stopSimulatedAudioLevel();
    _audioLevelController.close();
    _tts.stop();
  }
}
