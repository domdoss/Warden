import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/models.dart';
import '../../providers/chat_provider.dart';
import '../../providers/providers.dart';
import '../../services/avatar_service.dart';
import '../../theme.dart';
import '../mascot.dart';
import '../widgets/chat_chart.dart';

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key});

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _composer = TextEditingController();
  final _scroll = ScrollController();
  bool _listening = false;
  bool _showJump = false;
  int _lastCount = -1;
  String? _avatarPath;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
    AvatarService().getPath().then((p) {
      if (mounted && p != null) setState(() => _avatarPath = p);
    });
  }

  Future<void> _pickAvatar() async {
    final p = await AvatarService().pickAndSave();
    if (p != null && mounted) setState(() => _avatarPath = p);
  }

  void _onScroll() {
    if (!_scroll.hasClients) return;
    final nearBottom =
        _scroll.offset >= _scroll.position.maxScrollExtent - 120;
    if (_showJump == nearBottom) {
      setState(() => _showJump = !nearBottom);
    }
  }

  @override
  void dispose() {
    _scroll.removeListener(_onScroll);
    _composer.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _send() async {
    final text = _composer.text;
    if (text.trim().isEmpty) return;
    _composer.clear();
    await ref.read(chatProvider.notifier).send(text);
    _scrollToBottom();
  }

  Future<void> _toggleMic() async {
    final notifier = ref.read(chatProvider.notifier);
    if (_listening) {
      await ref.read(speechProvider).stop();
      setState(() => _listening = false);
      notifier.setListening(false);
      return;
    }
    setState(() => _listening = true);
    notifier.setListening(true);
    final text = await ref.read(speechProvider).listen();
    if (!mounted) return;
    setState(() => _listening = false);
    notifier.setListening(false);
    if (text != null && text.trim().isNotEmpty) {
      await notifier.send(text);
      _scrollToBottom();
    }
  }

  @override
  Widget build(BuildContext context) {
    final chat = ref.watch(chatProvider);
    final state = chat.valueOrNull ?? const ChatState();
    final messages = state.messages;
    final streaming = state.streaming;

    final pose = poseForChat(
      listening: _listening,
      sending: state.sending,
      streaming: streaming,
      error: state.error != null,
    );

    // Jump to the newest message whenever the list grows (incl. first load).
    if (messages.isNotEmpty && messages.length != _lastCount) {
      _lastCount = messages.length;
      _scrollToBottom();
    }

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 8,
        title: Row(
          children: [
            WardenMascot(pose: pose, size: 38),
            const SizedBox(width: 10),
            const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Warden',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                Text('your advocate, on your machine',
                    style: TextStyle(
                        fontSize: 11,
                        color: WardenColors.textDim,
                        fontWeight: FontWeight.w400)),
              ],
            ),
          ],
        ),
        actions: [
          if (streaming)
            IconButton(
              icon: const Icon(Icons.stop_circle_outlined,
                  color: WardenColors.red),
              onPressed: () => ref.read(chatProvider.notifier).stop(),
            ),
          IconButton(
            icon: const Icon(Icons.delete_outline, color: WardenColors.textDim),
            onPressed: () => ref.read(chatProvider.notifier).clearConversation(),
          ),
        ],
      ),
      body: Column(
        children: [
          if (state.error != null)
            Container(
              width: double.infinity,
              color: WardenColors.red.withValues(alpha: 0.12),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Text(state.error!,
                  style:
                      const TextStyle(color: WardenColors.red, fontSize: 12)),
            ),
          Expanded(
            child: Stack(
              children: [
                Positioned.fill(
                  child: messages.isEmpty && !streaming
                      ? _EmptyState(onTap: _toggleMic)
                      : ListView.builder(
                          controller: _scroll,
                          padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
                          itemCount: messages.length + (streaming ? 1 : 0),
                          itemBuilder: (context, i) {
                            if (i == messages.length) {
                              return _StreamingBubble(
                                  text: state.streamingText,
                                  listening: _listening);
                            }
                            return _MessageBubble(
                              message: messages[i],
                              avatarPath: _avatarPath,
                              onPickAvatar: _pickAvatar,
                            );
                          },
                        ),
                ),
                if (_showJump && messages.isNotEmpty)
                  Positioned(
                    right: 12,
                    bottom: 12,
                    child: FloatingActionButton.small(
                      backgroundColor: WardenColors.surfaceAlt,
                      onPressed: _scrollToBottom,
                      child: const Icon(Icons.arrow_downward,
                          color: WardenColors.cyan),
                    ),
                  ),
              ],
            ),
          ),
          _ComposerBar(
            controller: _composer,
            listening: _listening,
            onMic: _toggleMic,
            onSend: _send,
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final VoidCallback onTap;
  const _EmptyState({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const WardenMascot(pose: MascotPose.idle, size: 140),
          const SizedBox(height: 24),
          const Text('Warden',
              style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          const Text('Your AI, on your phone, from anywhere.',
              style: TextStyle(color: WardenColors.textDim)),
          const SizedBox(height: 24),
          FilledButton.icon(
            style: FilledButton.styleFrom(
              backgroundColor: WardenColors.cyan,
              foregroundColor: WardenColors.background,
            ),
            onPressed: onTap,
            icon: const Icon(Icons.mic),
            label: const Text('Talk to Warden'),
          ),
        ],
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  final ChatMessage message;
  final String? avatarPath;
  final VoidCallback? onPickAvatar;
  const _MessageBubble({
    required this.message,
    this.avatarPath,
    this.onPickAvatar,
  });

  @override
  Widget build(BuildContext context) {
    final mine = message.fromUser;
    final align = mine ? CrossAxisAlignment.end : CrossAxisAlignment.start;

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(crossAxisAlignment: align, children: [
        if (mine) _userBubble(context, message) else _assistantBubble(message),
        if (message.timestamp != null)
          Padding(
            padding: const EdgeInsets.only(top: 3),
            child: Text(
              _fmtTime(message.timestamp!),
              style: const TextStyle(fontSize: 10, color: WardenColors.textDim),
            ),
          ),
      ]),
    );
  }

  Widget _userBubble(BuildContext context, ChatMessage m) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.end,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Flexible(
          child: Container(
            constraints: BoxConstraints(
                maxWidth: MediaQuery.of(context).size.width * 0.70),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: WardenColors.crimson,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Text(m.content,
                style: const TextStyle(
                    color: WardenColors.background, fontSize: 15)),
          ),
        ),
        const SizedBox(width: 8),
        GestureDetector(
          onTap: onPickAvatar,
          child: _userAvatar(),
        ),
      ],
    );
  }

  /// The sender's bubble avatar. Tap it to upload a photo; until one is set it
  /// shows a tappable person placeholder.
  Widget _userAvatar() {
    const size = 32.0;
    final path = avatarPath;
    if (path != null && File(path).existsSync()) {
      return ClipOval(
        child: Image.file(
          File(path),
          width: size,
          height: size,
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => _avatarPlaceholder(),
        ),
      );
    }
    return _avatarPlaceholder();
  }

  Widget _avatarPlaceholder() {
    return Container(
      width: 32,
      height: 32,
      decoration: BoxDecoration(
        color: WardenColors.surfaceAlt,
        shape: BoxShape.circle,
        border: Border.all(color: WardenColors.border),
      ),
      child: const Icon(Icons.person, size: 18, color: WardenColors.textDim),
    );
  }

  Widget _assistantBubble(ChatMessage m) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const WardenMascot(pose: MascotPose.idle, size: 28),
        const SizedBox(width: 8),
        Flexible(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: WardenColors.surfaceAlt,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: WardenColors.border),
            ),
            child: ChatMarkdown(data: m.content),
          ),
        ),
      ],
    );
  }
}

class _StreamingBubble extends StatelessWidget {
  final String text;
  final bool listening;
  const _StreamingBubble({required this.text, required this.listening});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const WardenMascot(pose: MascotPose.charging, size: 28),
          const SizedBox(width: 8),
          Flexible(
            child: Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: WardenColors.surfaceAlt,
                borderRadius: BorderRadius.circular(16),
              ),
              child: text.isEmpty
                  ? Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        _Dot(delay: 0),
                        _Dot(delay: 1),
                        _Dot(delay: 2),
                      ],
                    )
                  : Text(text,
                      style: const TextStyle(
                          color: WardenColors.text, fontSize: 14)),
            ),
          ),
        ],
      ),
    );
  }
}

class _Dot extends StatefulWidget {
  final int delay;
  const _Dot({required this.delay});
  @override
  State<_Dot> createState() => _DotState();
}

class _DotState extends State<_Dot> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, _) => Container(
        width: 6,
        height: 6,
        margin: const EdgeInsets.symmetric(horizontal: 2),
        decoration: BoxDecoration(
          color: WardenColors.cyan
              .withValues(alpha: 0.3 + 0.7 * _c.value),
          shape: BoxShape.circle,
        ),
      ),
    );
  }
}

class _ComposerBar extends StatelessWidget {
  final TextEditingController controller;
  final bool listening;
  final VoidCallback onMic;
  final VoidCallback onSend;

  const _ComposerBar({
    required this.controller,
    required this.listening,
    required this.onMic,
    required this.onSend,
  });

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
        color: WardenColors.surface,
        child: Row(
          children: [
            IconButton(
              onPressed: onMic,
              icon: Icon(
                listening ? Icons.stop : Icons.mic_none,
                color: listening ? WardenColors.red : WardenColors.cyan,
              ),
            ),
            Expanded(
              child: TextField(
                controller: controller,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => onSend(),
                style: const TextStyle(color: WardenColors.text),
                decoration: InputDecoration(
                  hintText: listening ? 'Listening…' : 'Message Warden',
                  hintStyle: const TextStyle(color: WardenColors.textDim),
                  filled: true,
                  fillColor: WardenColors.surfaceAlt,
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
            ),
            IconButton(
              onPressed: onSend,
              icon: const Icon(Icons.arrow_upward,
                  color: WardenColors.cyan),
            ),
          ],
        ),
      ),
    );
  }
}

String _fmtTime(DateTime t) {
  final now = DateTime.now();
  final sameDay = now.year == t.year &&
      now.month == t.month &&
      now.day == t.day;
  final h = t.hour.toString().padLeft(2, '0');
  final m = t.minute.toString().padLeft(2, '0');
  if (sameDay) return '$h:$m';
  return '${t.month}/${t.day} $h:$m';
}
