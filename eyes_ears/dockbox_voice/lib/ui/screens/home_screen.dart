import 'package:flutter/material.dart';

import '../../config/theme.dart';
import '../widgets/hologram_widget.dart';

/// Main screen — the Three.js hologram fills the screen.
/// Tap anywhere on the hologram to talk.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      body: Stack(
        children: [
          // Full-screen Three.js hologram
          const Positioned.fill(child: HologramWidget()),

          // Settings gear
          Positioned(
            top: MediaQuery.of(context).padding.top + 8,
            right: 16,
            child: IconButton(
              icon: const Icon(Icons.settings, color: AppTheme.cyan),
              onPressed: () => Navigator.of(context).pushNamed('/settings'),
            ),
          ),
        ],
      ),
    );
  }
}
