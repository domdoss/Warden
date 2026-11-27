import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/chat_provider.dart';
import '../../providers/providers.dart';
import '../../theme.dart';
import '../hologram_view.dart';
import '../voice_level.dart';
import 'agenda_screen.dart';
import 'botnet_screen.dart';
import 'friends_screen.dart';
import 'image_gen_screen.dart';
import 'projects_screen.dart';

/// Home — the hologram is the Warden's living core. Tap it once and it holds
/// a conversation: listen → reply → speak → listen, until you tap again (or
/// say a stop word).
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  bool _listening = false;
  bool _conversationActive = false;
  int _turnId = 0;

  Future<void> _talk() async {
    final tts = ref.read(ttsProvider);
    final notifier = ref.read(chatProvider.notifier);

    if (_conversationActive) {
      // tap again = end the conversation
      _turnId++;
      setState(() {
        _conversationActive = false;
        _listening = false;
      });
      notifier.setListening(false);
      await ref.read(speechProvider).stop();
      await tts.stop();
      return;
    }

    setState(() => _conversationActive = true);
    _turnId++;
    final myTurn = _turnId;

    // When the assistant finishes speaking, listen for the next thing.
    tts.onSpeechComplete = () {
      if (!_conversationActive || myTurn != _turnId) return;
      Future.delayed(const Duration(milliseconds: 400), () {
        if (_conversationActive && myTurn == _turnId && mounted) {
          unawaited(_nextTurn(myTurn));
        }
      });
    };

    await _nextTurn(myTurn);
  }

  Future<void> _nextTurn(int myTurn) async {
    if (!_conversationActive || myTurn != _turnId || !mounted) return;
    final notifier = ref.read(chatProvider.notifier);

    setState(() => _listening = true);
    notifier.setListening(true);
    final text = await ref.read(speechProvider).listen();
    if (!mounted || !_conversationActive || myTurn != _turnId) return;
    setState(() => _listening = false);
    notifier.setListening(false);

    if (text == null || text.trim().isEmpty) {
      // nothing heard — pause, then listen again
      await Future.delayed(const Duration(milliseconds: 1400));
      if (_conversationActive && myTurn == _turnId && mounted) {
        unawaited(_nextTurn(myTurn));
      }
      return;
    }

    final trimmed = text.trim();
    if (_isStopWord(trimmed)) {
      _turnId++;
      setState(() => _conversationActive = false);
      notifier.setListening(false);
      return;
    }

    await notifier.send(trimmed);
    // reply + speech arrive via SSE; onSpeechComplete advances the loop.
  }

  bool _isStopWord(String t) {
    final s = t
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z ]'), ' ')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
    const stops = {
      'stop', 'end', 'quit', 'exit', 'goodbye', 'bye', 'that is all',
      'thats all', 'thank you', 'thanks',
    };
    return stops.contains(s);
  }

  @override
  Widget build(BuildContext context) {
    final chat = ref.watch(chatProvider);
    final s = chat.valueOrNull ?? const ChatState();

    final state = _listening
        ? 'listening'
        : s.streaming
            ? 'processing'
            : (s.error != null ? 'error' : 'idle');

    return Stack(
      fit: StackFit.expand,
      children: [
        HologramView(state: state, level: voiceLevel, onTap: _talk),
        Positioned(
          left: 16,
          right: 16,
          bottom: 18,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _QuickRow(
                onCalendar: () => _push(const AgendaScreen()),
                onProjects: () => _push(const ProjectsScreen()),
                onFriends: () => _push(const FriendsScreen()),
                onBotNet: () => _push(const BotNetScreen()),
                onCreate: () => _push(const ImageGenScreen()),
              ),
              const SizedBox(height: 10),
              _TalkPill(
                listening: _listening,
                conversationActive: _conversationActive,
                onTap: _talk,
              ),
            ],
          ),
        ),
      ],
    );
  }

  void _push(Widget page) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
  }
}

class _TalkPill extends StatelessWidget {
  final bool listening;
  final bool conversationActive;
  final VoidCallback onTap;
  const _TalkPill({
    required this.listening,
    required this.conversationActive,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final label = listening
        ? 'LISTENING…'
        : (conversationActive ? 'TAP TO END' : 'TAP TO TALK');
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(26),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 13),
        decoration: BoxDecoration(
          gradient: LinearGradient(colors: [
            WardenColors.crimson,
            WardenColors.crimson.withValues(alpha: 0.75),
          ]),
          borderRadius: BorderRadius.circular(26),
          boxShadow: [
            BoxShadow(
              color: WardenColors.crimson.withValues(alpha: 0.45),
              blurRadius: 24,
            ),
          ],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(listening || conversationActive ? Icons.stop : Icons.mic_none,
                color: WardenColors.background, size: 18),
            const SizedBox(width: 8),
            Text(
              label,
              style: const TextStyle(
                  color: WardenColors.background,
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.5),
            ),
          ],
        ),
      ),
    );
  }
}

class _QuickRow extends StatelessWidget {
  final VoidCallback onCalendar;
  final VoidCallback onProjects;
  final VoidCallback onFriends;
  final VoidCallback onBotNet;
  final VoidCallback onCreate;
  const _QuickRow({
    required this.onCalendar,
    required this.onProjects,
    required this.onFriends,
    required this.onBotNet,
    required this.onCreate,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: WardenColors.surface.withValues(alpha: 0.7),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: WardenColors.border),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _q(Icons.event_note_outlined, 'Calendar', onCalendar),
          _q(Icons.folder_copy_outlined, 'Projects', onProjects),
          _q(Icons.people_outline, 'Friends', onFriends),
          _q(Icons.hub_outlined, 'BotNet', onBotNet),
          _q(Icons.auto_awesome, 'Create', onCreate),
        ],
      ),
    );
  }

  Widget _q(IconData icon, String label, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: WardenColors.cyan, size: 20),
            const SizedBox(height: 3),
            Text(label,
                style: const TextStyle(
                    color: WardenColors.textDim, fontSize: 10)),
          ],
        ),
      ),
    );
  }
}
