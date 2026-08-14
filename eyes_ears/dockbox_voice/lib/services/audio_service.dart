import 'package:audioplayers/audioplayers.dart';

/// Plays beep sounds for conversation feedback.
///
/// Replaces the Python app's BeepGenerator.
class AudioService {
  final AudioPlayer _player = AudioPlayer();

  Future<void> playStartBeep() async {
    await _play('start_beep.wav');
  }

  Future<void> playStopBeep() async {
    await _play('stop_beep.wav');
  }

  Future<void> playErrorBeep() async {
    await _play('error_beep.wav');
  }

  Future<void> _play(String filename) async {
    try {
      await _player.play(AssetSource('beeps/$filename'));
    } catch (e) {
      print('[audio] Failed to play $filename: $e');
    }
  }

  void dispose() {
    _player.dispose();
  }
}
