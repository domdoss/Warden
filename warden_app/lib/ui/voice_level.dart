import 'package:flutter/foundation.dart';

/// Live voice amplitude shared by TTS output and the microphone input, 0..1.
/// The hologram pulses to this.
final ValueNotifier<double> voiceLevel = ValueNotifier<double>(0.0);
