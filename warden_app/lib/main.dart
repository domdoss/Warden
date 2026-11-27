import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'providers/providers.dart';
import 'services/tailscale_service.dart';
import 'theme.dart';
import 'ui/home_shell.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: WardenApp()));
}

class WardenApp extends StatelessWidget {
  const WardenApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Warden',
      debugShowCheckedModeBanner: false,
      theme: wardenTheme(),
      home: const AppBootstrap(),
    );
  }
}

/// Loads settings, configures the embedded Tailscale node, and starts it once.
class AppBootstrap extends ConsumerWidget {
  const AppBootstrap({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.listen(settingsProvider, (prev, next) {
      if (next.hasValue && !_tailscaleStarted) {
        _tailscaleStarted = true;
        final s = next.value!;
        TailscaleService.instance.configure(authKey: s.authKey);
        unawaited(TailscaleService.instance.start());
      }
    });
    return const HomeShell();
  }
}

bool _tailscaleStarted = false;
