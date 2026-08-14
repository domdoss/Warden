import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../config/theme.dart';
import '../../models/app_state.dart';
import '../../providers/conversation_provider.dart';

/// The big push-to-talk button.
class TalkButton extends ConsumerWidget {
  const TalkButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final conv = ref.watch(conversationProvider);
    final appState = conv.valueOrNull?.appState ?? AppState.idle;
    final isActive = appState != AppState.idle && appState != AppState.error;

    return GestureDetector(
      onTap: () {
        ref.read(conversationProvider.notifier).handleInteraction();
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        width: 100,
        height: 100,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: isActive
              ? AppTheme.red.withValues(alpha: 0.3)
              : AppTheme.cyan.withValues(alpha: 0.15),
          border: Border.all(
            color: isActive ? AppTheme.red : AppTheme.cyan,
            width: 2,
          ),
          boxShadow: [
            BoxShadow(
              color: (isActive ? AppTheme.red : AppTheme.cyan).withValues(alpha: 0.4),
              blurRadius: 20,
              spreadRadius: 2,
            ),
          ],
        ),
        child: Icon(
          isActive ? Icons.stop : Icons.mic,
          color: isActive ? AppTheme.red : AppTheme.cyan,
          size: 40,
        ),
      ),
    );
  }
}
