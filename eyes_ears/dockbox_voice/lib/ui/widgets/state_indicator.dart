import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../config/theme.dart';
import '../../models/app_state.dart';
import '../../providers/conversation_provider.dart';

/// Shows the current state as a text label below the hologram.
class StateIndicator extends ConsumerWidget {
  const StateIndicator({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final conv = ref.watch(conversationProvider);
    final appState = conv.valueOrNull?.appState ?? AppState.idle;
    final transcribedText = conv.valueOrNull?.transcribedText;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          _label(appState),
          style: TextStyle(
            color: _color(appState),
            fontSize: 14,
            fontFamily: 'monospace',
            letterSpacing: 2,
          ),
        ),
        if (transcribedText != null && transcribedText.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              transcribedText,
              style: TextStyle(
                color: AppTheme.cyan.withValues(alpha: 0.6),
                fontSize: 12,
                fontFamily: 'monospace',
              ),
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
      ],
    );
  }

  String _label(AppState state) {
    switch (state) {
      case AppState.idle:
        return 'TAP TO TALK';
      case AppState.listening:
        return 'LISTENING...';
      case AppState.processing:
        return 'THINKING...';
      case AppState.speaking:
        return 'SPEAKING...';
      case AppState.error:
        return 'ERROR';
    }
  }

  Color _color(AppState state) {
    switch (state) {
      case AppState.idle:
        return AppTheme.cyan;
      case AppState.listening:
        return AppTheme.red;
      case AppState.processing:
        return AppTheme.orange;
      case AppState.speaking:
        return AppTheme.cyan;
      case AppState.error:
        return AppTheme.errorRed;
    }
  }
}
