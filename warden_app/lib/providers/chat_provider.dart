import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/models.dart';
import '../services/api_client.dart';
import 'providers.dart';

class ChatState {
  final List<ChatMessage> messages;
  final bool streaming; // an assistant reply is in progress
  final bool listening; // mic is open
  final bool sending; // user message in flight
  final String streamingText; // live preview while streaming
  final String? error;

  const ChatState({
    this.messages = const [],
    this.streaming = false,
    this.listening = false,
    this.sending = false,
    this.streamingText = '',
    this.error,
  });

  ChatState copyWith({
    List<ChatMessage>? messages,
    bool? streaming,
    bool? listening,
    bool? sending,
    String? streamingText,
    String? error,
    bool clearError = false,
  }) =>
      ChatState(
        messages: messages ?? this.messages,
        streaming: streaming ?? this.streaming,
        listening: listening ?? this.listening,
        sending: sending ?? this.sending,
        streamingText: streamingText ?? this.streamingText,
        error: clearError ? null : (error ?? this.error),
      );
}

class ChatNotifier extends AsyncNotifier<ChatState> {
  StreamSubscription<ChatEvent>? _sub;
  final List<String> _liveLines = [];

  @override
  Future<ChatState> build() async {
    final api = ref.watch(apiProvider);
    _sub?.cancel();
    _sub = api.notifications().listen(_onEvent, onError: (_) {});
    ref.onDispose(() => _sub?.cancel());

    List<ChatMessage> msgs = [];
    try {
      msgs = await api.messages();
    } catch (_) {
      // history is best-effort; the stream still works
    }
    return ChatState(messages: msgs);
  }

  void _onEvent(ChatEvent e) {
    final t = e.type;
    if (t == 'connected' || t == 'ping' || t == 'keepalive') return;

    if (t == 'agent_activity') {
      final line = _filterLine(e.line);
      if (line.isEmpty) return;
      _liveLines.add(line);
      final s = state.valueOrNull;
      if (s != null) {
        state = AsyncData(
            s.copyWith(streaming: true, streamingText: _liveLines.join('\n')));
      }
      return;
    }

    if (t == 'done' ||
        t == 'turn_end' ||
        t == 'complete' ||
        t == 'agent_done' ||
        t == 'chat_complete') {
      final finalText = e.message.trim().isNotEmpty
          ? e.message
          : _liveLines.join('\n').trim();
      unawaited(ref.read(apiProvider).reportDebug('chat_complete', {
        'type': t,
        'msg': e.message,
        'msgLen': e.message.length,
        'finalTextLen': finalText.length,
        'liveLines': _liveLines.length,
      }));
      final s = state.valueOrNull;
      if (s != null) {
        var msgs = List<ChatMessage>.from(s.messages);
        if (finalText.isNotEmpty) {
          msgs.add(ChatMessage(
            id: 'a-${DateTime.now().microsecondsSinceEpoch}',
            fromUser: false,
            content: finalText,
            timestamp: DateTime.now(),
          ));
          unawaited(ref.read(ttsProvider)
              .speak(finalText, reportUrl: ref.read(apiProvider).baseUrl));
        }
        state = AsyncData(
            s.copyWith(messages: msgs, streaming: false, streamingText: ''));
      }
      _liveLines.clear();
    }
  }

  Future<void> send(String text, {String? model}) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return;
    final s = state.valueOrNull ?? const ChatState();
    final userMsg = ChatMessage(
      id: 'u-${DateTime.now().microsecondsSinceEpoch}',
      fromUser: true,
      content: trimmed,
      timestamp: DateTime.now(),
    );
    state = AsyncData(s.copyWith(
      messages: [...s.messages, userMsg],
      streaming: true,
      streamingText: '',
      sending: true,
      clearError: true,
    ));

    try {
      await ref.read(apiProvider).sendMessage(trimmed, model: model);
    } catch (e) {
      final cur = state.valueOrNull;
      if (cur != null) {
        state = AsyncData(cur.copyWith(
            sending: false, streaming: false, error: 'Send failed: $e'));
      }
    }
  }

  Future<void> stop() async {
    await ref.read(apiProvider).stopChat();
    await ref.read(ttsProvider).stop();
    final s = state.valueOrNull;
    if (s != null) {
      state = AsyncData(s.copyWith(streaming: false, sending: false));
    }
    _liveLines.clear();
  }

  void setListening(bool v) {
    final s = state.valueOrNull;
    if (s != null) state = AsyncData(s.copyWith(listening: v));
  }

  Future<void> clearConversation() async {
    await ref.read(apiProvider).clearConversation();
    state = AsyncData(const ChatState());
  }

  /// Drop noisy agent-log lines so the live preview reads like a reply.
  String _filterLine(String line) {
    final stripped = line.trimLeft();
    if (stripped.isEmpty) return '';
    if (stripped.startsWith('[') && stripped.contains(']') && stripped.length < 60) {
      return '';
    }
    if (RegExp(r'^[A-Z][A-Z0-9_]*=').hasMatch(stripped)) return '';
    if (stripped.startsWith('{"model"') ||
        stripped.startsWith('{"id"') ||
        stripped.startsWith('{"role"')) {
      return '';
    }
    if (stripped.startsWith('🤔') ||
        stripped.startsWith('────') ||
        stripped.startsWith('🔧') ||
        stripped.startsWith('→')) {
      return '';
    }
    if (stripped.startsWith('✅') ||
        stripped.startsWith('❌') ||
        stripped.startsWith('⚠️')) {
      return '';
    }
    if (stripped.startsWith('[agent-runner]')) return '';
    return line.trim();
  }
}

final chatProvider =
    AsyncNotifierProvider<ChatNotifier, ChatState>(ChatNotifier.new);
