import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:permission_handler/permission_handler.dart';

import 'app.dart';
import 'services/tailscale_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Bring up the baked-in Tailscale node in the background. It enrolls with the
  // bundled auth key, then the app's API provider flips to the localhost proxy
  // as soon as Warden answers over the tunnel. Nothing blocks the first frame.
  unawaited(TailscaleService.start());

  // Request microphone permission on Android
  final micStatus = await Permission.microphone.status;
  if (!micStatus.isGranted) {
    await Permission.microphone.request();
  }

  runApp(
    const ProviderScope(
      child: DockboxVoiceApp(),
    ),
  );
}
