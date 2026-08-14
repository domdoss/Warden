import 'dart:async';

import 'package:speech_to_text/speech_to_text.dart' as stt;

/// Wraps Android's built-in SpeechRecognizer.
class SpeechService {
  final stt.SpeechToText _stt = stt.SpeechToText();
  bool _initialized = false;
  Completer<String?>? _completer;
  String _text = '';
  Timer? _silenceTimer;

  Future<bool> initialize() async {
    if (_initialized) return true;
    _initialized = await _stt.initialize(
      onStatus: _onStatus,
    );
    return _initialized;
  }

  void _onStatus(String status) {
    print('[stt] status: $status');
    if (status == 'done' || status == 'notListening') {
      _silenceTimer?.cancel();
      if (_completer != null && !_completer!.isCompleted) {
        _completer!.complete(_text.isNotEmpty ? _text : null);
      }
    }
  }

  bool get isAvailable => _initialized;

  Future<String?> listen({
    Duration? maxDuration,
    Duration? silenceTimeout,
  }) async {
    if (!_initialized) {
      final ok = await initialize();
      if (!ok) return null;
    }

    _text = '';
    _completer = Completer<String?>();
    final silence = silenceTimeout ?? const Duration(seconds: 1);

    void resetSilenceTimer() {
      _silenceTimer?.cancel();
      _silenceTimer = Timer(silence, () {
        print('[stt] silence timeout, stopping');
        _stt.stop();
      });
    }

    // Start the silence timer — will fire if no speech at all
    resetSilenceTimer();

    await _stt.listen(
      onResult: (result) {
        _text = result.recognizedWords;
        print('[stt] heard: "${_text}" final=${result.finalResult}');
        if (_text.isNotEmpty) {
          resetSilenceTimer();
        }
        if (result.finalResult) {
          _silenceTimer?.cancel();
          if (_completer != null && !_completer!.isCompleted) {
            _completer!.complete(_text.isNotEmpty ? _text : null);
          }
        }
      },
      listenOptions: stt.SpeechListenOptions(
        cancelOnError: true,
      ),
    );

    // Wait for completion
    final result = await _completer!.future.timeout(
      maxDuration ?? const Duration(seconds: 30),
      onTimeout: () {
        _stt.stop();
        return _text.isNotEmpty ? _text : null;
      },
    );

    _silenceTimer?.cancel();
    _completer = null;
    return result;
  }

  Future<void> cancel() async {
    _silenceTimer?.cancel();
    _completer?.complete(null);
    _completer = null;
    await _stt.cancel();
  }

  Future<void> stop() async {
    _silenceTimer?.cancel();
    await _stt.stop();
  }
}
