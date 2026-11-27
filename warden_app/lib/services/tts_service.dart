import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_tts/flutter_tts.dart';

import '../config/app_config.dart';
import '../ui/voice_level.dart';

/// Built-in Android TTS. Also reports every attempt to the Warden log so a
/// silent failure is visible — whether it's "not called", "throws", or
/// "no engine".
class TtsService {
  final FlutterTts _tts = FlutterTts();
  bool _initialized = false;
  Timer? _levelTimer;

  /// Called when the engine finishes speaking (drives conversation mode).
  void Function()? onSpeechComplete;

  Future<void> initialize() async {
    if (_initialized) return;
    try {
      await _tts.setLanguage('en-US');
      await _tts.setSpeechRate(0.5);
      await _tts.setPitch(1.0);
      _tts.setCompletionHandler(() {
        _stopSimulatedLevel();
        voiceLevel.value = 0;
        onSpeechComplete?.call();
      });
      _initialized = true;
    } catch (_) {
      // never throw; speak() will report the failure
    }
  }

  Future<void> speak(String text, {String? reportUrl}) async {
    final url = reportUrl ?? AppConfig.embeddedServerUrl;
    String? error;
    int len = 0;

    try {
      if (!_initialized) await initialize();
      if (text.trim().isEmpty) return;
      final cleaned = _clean(text);
      if (cleaned.isEmpty) return;
      len = cleaned.length;

      _startSimulatedLevel(cleaned);
      try {
        await _tts.speak(cleaned);
      } catch (e) {
        error = 'speak: $e';
      }
      _stopSimulatedLevel();
      voiceLevel.value = 0;
    } catch (e) {
      error = 'pipeline: $e';
    } finally {
      unawaited(_reportDebug(len, error, url));
    }
  }

  Future<void> _reportDebug(int textLen, String? error, String reportUrl) async {
    try {
      final engines = await _tts.getEngines;
      final lang = await _tts.isLanguageAvailable('en-US');
      final maxLen = await _tts.getMaxSpeechInputLength;
      final dio = Dio(BaseOptions(
        baseUrl: reportUrl,
        connectTimeout: const Duration(seconds: 3),
        receiveTimeout: const Duration(seconds: 3),
      ));
      await dio.post('/api/debug-log', data: {
        'tag': 'tts',
        'data': {
          'textLen': textLen,
          'error': error,
          'engines': engines,
          'enUS_available': lang,
          'maxInputLen': maxLen,
        },
      });
    } catch (_) {
      // diagnostic only
    }
  }

  Future<void> stop() async {
    _stopSimulatedLevel();
    voiceLevel.value = 0;
    await _tts.stop();
  }

  String _clean(String t) {
    return t
        .replaceAll(RegExp(r'\[\s*DONE\s*\]', caseSensitive: false), '')
        .replaceAll(RegExp(r'```[^`]*```', dotAll: true), ' ')
        .replaceAll(RegExp(r'`([^`]*)`'), r'$1')
        .replaceAll(RegExp(r'\*\*([^*]+)\*\*'), r'$1')
        .replaceAll(RegExp(r'\*([^*]+)\*'), r'$1')
        .replaceAll(RegExp(r'#{1,6}\s*'), '')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
  }

  void _startSimulatedLevel(String text) {
    _stopSimulatedLevel();
    final estimatedMs =
        ((text.length / 5) * (60000 / 150)).toInt().clamp(500, 30000);
    final steps = (estimatedMs / 50).toInt().clamp(10, 600);
    int step = 0;

    _levelTimer = Timer.periodic(const Duration(milliseconds: 50), (timer) {
      if (step >= steps) {
        timer.cancel();
        voiceLevel.value = 0;
        return;
      }
      final phase = step / steps;
      final level = (phase < 0.5) ? phase * 2.0 : (1.0 - phase) * 2.0;
      voiceLevel.value = level.clamp(0.0, 1.0);
      step++;
    });
  }

  void _stopSimulatedLevel() {
    _levelTimer?.cancel();
    _levelTimer = null;
  }
}
