import 'package:flutter/material.dart';

import 'config/theme.dart';
import 'ui/screens/home_screen.dart';
import 'ui/screens/settings_screen.dart';

/// Root widget for Dockbox Voice.
class DockboxVoiceApp extends StatelessWidget {
  const DockboxVoiceApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Dockbox Voice',
      theme: AppTheme.darkTheme,
      debugShowCheckedModeBanner: false,
      initialRoute: '/',
      routes: {
        '/': (_) => const HomeScreen(),
        '/settings': (_) => const SettingsScreen(),
      },
    );
  }
}
