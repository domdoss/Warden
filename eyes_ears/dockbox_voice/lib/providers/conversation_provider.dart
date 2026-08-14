import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/app_state.dart';
import '../models/conversation_state.dart';
import '../services/audio_service.dart';
import '../services/dockbox_api_service.dart';
import '../services/dockbox_bridge.dart';
import '../services/speech_service.dart';
import '../services/tts_service.dart';
import '../utils/sentence_splitter.dart';
import '../utils/text_utils.dart';
import 'settings_provider.dart';

// ---- service providers ----

final dockboxApiProvider = Provider<DockboxApiService>((ref) {
  final config = ref.watch(serverConfigProvider).valueOrNull;
  final url = config?.serverUrl ?? 'http://10.0.0.47:3200';
  return DockboxApiService(baseUrl: url);
});

final dockboxBridgeProvider = Provider<DockboxBridge>((ref) {
  final api = ref.watch(dockboxApiProvider);
  return DockboxBridge(api);
});

final speechServiceProvider = Provider<SpeechService>((ref) => SpeechService());
final ttsServiceProvider = Provider<TtsService>((ref) => TtsService());
final audioServiceProvider = Provider<AudioService>((ref) => AudioService());

// ---- conversation notifier ----

final conversationProvider =
    AsyncNotifierProvider<ConversationNotifier, ConversationState>(
  ConversationNotifier.new,
);

class ConversationNotifier extends AsyncNotifier<ConversationState> {
  // TTS queue: SSE chunks accumulate here; a worker speaks them in order.
  final _ttsQueue = StreamController<String?>.broadcast();
  StreamSubscription<String?>? _ttsWorkerSub;
  final _sentenceSplitter = SentenceSplitter();

  // Turn-done signal
  Completer<void>? _turnDone;

  // Track whether the current reply is a sign-off
  bool _endConversation = false;

  // Track whether we're currently speaking
  bool _isSpeaking = false;

  // Track the full reply for sign-off detection
  final List<String> _replyBuffer = [];

  // Stop flag for interrupting the conversation loop
  bool _stopRequested = false;

  @override
  Future<ConversationState> build() async {
    // Initialize speech service
    ref.read(speechServiceProvider).initialize();

    // Wire up the bridge callbacks
    final bridge = ref.read(dockboxBridgeProvider);
    bridge.onChunk = _enqueueChunk;
    bridge.onTurnEnd = _onTurnEnd;

    // Start the SSE stream
    bridge.start();

    // Start the TTS worker
    _startTtsWorker();

    ref.onDispose(() {
      _ttsWorkerSub?.cancel();
      _ttsQueue.close();
      bridge.stop();
    });

    return const ConversationState();
  }

  // ---- public API ----

  /// Handle a button press: start a conversation or interrupt an active one.
  Future<void> handleInteraction() async {
    final current = state.valueOrNull;
    if (current == null) return;

    if (!current.conversationActive) {
      // Start new conversation
      state = AsyncData(current.copyWith(conversationActive: true));
      await _runConversation();
    } else {
      // Interrupt
      await _interrupt();
    }
  }

  // ---- conversation loop ----

  Future<void> _runConversation() async {
    _stopRequested = false;
    try {
      while (!_stopRequested) {
        final keepGoing = await _singleTurn();
        if (!keepGoing || _stopRequested) break;
      }
    } finally {
      _stopRequested = false;
      _setAppState(AppState.idle);
      state = AsyncData(state.valueOrNull!.copyWith(conversationActive: false));
    }
  }

  /// One full turn: listen → transcribe → send → receive reply → speak.
  /// Ported from main.py _single_turn.
  Future<bool> _singleTurn() async {
    try {
      // Wait until not speaking
      await _waitUntilQuiet();

      // ---- Listen ----
      _setAppState(AppState.listening);
      final audio = ref.read(audioServiceProvider);
      await audio.playStartBeep();

      final speech = ref.read(speechServiceProvider);
      final text = await speech.listen(
        maxDuration: const Duration(seconds: 30),
        silenceTimeout: const Duration(seconds: 1),
      );

      if (text == null || text.isEmpty) return false;

      await audio.playStopBeep();
      _setAppState(AppState.processing);

      print('User said: $text');
      state = AsyncData(state.valueOrNull!.copyWith(transcribedText: text));

      // Check if user ended
      final userEnded = TextUtils.userEnded(text);

      // ---- Send to server ----
      _turnDone = Completer<void>();
      _endConversation = false;

      final api = ref.read(dockboxApiProvider);
      final config = ref.read(serverConfigProvider).valueOrNull;
      final jid = config?.defaultJid ?? 'owner@local';
      final senderName = config?.senderName ?? 'Jarvis';
      final model = config?.model;

      await api.sendMessage(
        text: text,
        jid: jid,
        senderName: senderName,
        model: model,
      );

      // ---- Wait for reply (SSE will push chunks) ----
      _setAppState(AppState.processing);
      try {
        await _turnDone!.future;
      } catch (_) {
        return false;
      }

      if (_endConversation || userEnded) return false;
      return true;
    } catch (e) {
      print('Turn error: $e');
      final audio = ref.read(audioServiceProvider);
      await audio.playErrorBeep();
      _setAppState(AppState.error);
      await Future.delayed(const Duration(seconds: 2));
      _setAppState(AppState.idle);
      return false;
    }
  }

  /// Interrupt the current conversation.
  /// During listening: stop and submit whatever was captured.
  /// During speaking/processing: hard cancel.
  Future<void> _interrupt() async {
    final current = state.valueOrNull;
    if (current == null) return;

    // If listening, just stop the mic — captured text gets submitted
    if (current.appState == AppState.listening) {
      final speech = ref.read(speechServiceProvider);
      await speech.stop();
      return;
    }

    _stopRequested = true;

    if (_isSpeaking) {
      final tts = ref.read(ttsServiceProvider);
      await tts.stop();
      _isSpeaking = false;
      _turnDone?.complete();
      _turnDone = null;
    }

    // Cancel speech recognition (discard)
    final speech = ref.read(speechServiceProvider);
    await speech.cancel();

    // Stop server-side generation
    try {
      final api = ref.read(dockboxApiProvider);
      await api.stopChat();
    } catch (_) {}

    _turnDone?.complete();
    _turnDone = null;
    _setAppState(AppState.idle);
    state = AsyncData(current.copyWith(conversationActive: false));
  }

  // ---- TTS pipeline ----

  void _enqueueChunk(String chunk) {
    _ttsQueue.add(chunk);
  }

  void _onTurnEnd() {
    _ttsQueue.add(null); // null signals end of turn
  }

  void _startTtsWorker() {
    _ttsWorkerSub = _ttsQueue.stream.listen((chunk) async {
      if (chunk == null) {
        // Turn end: flush remaining buffer
        final text = _sentenceSplitter.flush();
        if (text.isNotEmpty) {
          await _speak(text);
        }

        // Check for sign-off
        _endConversation = TextUtils.isSignoff(_replyBuffer.join(' '));
        _replyBuffer.clear();

        _setAppState(AppState.idle);
        _turnDone?.complete();
        _turnDone = null;
        return;
      }

      _replyBuffer.add(chunk);
      final sentences = _sentenceSplitter.addChunk(chunk);
      for (final sentence in sentences) {
        if (sentence.trim().isNotEmpty) {
          await _speak(sentence);
        }
      }
    });
  }

  Future<void> _speak(String text) async {
    try {
      // Strip [DONE] markers and markdown
      String cleaned = text.replaceAll(RegExp(r'\[\s*DONE\s*\]', caseSensitive: false), '');
      cleaned = TextUtils.stripMarkdown(cleaned);
      if (cleaned.isEmpty) return;

      _isSpeaking = true;
      _setAppState(AppState.speaking);

      final tts = ref.read(ttsServiceProvider);
      await tts.speak(cleaned);
    } catch (e) {
      print('TTS error: $e');
    } finally {
      _isSpeaking = false;
      state = AsyncData(state.valueOrNull!.copyWith(audioLevel: 0.0));
    }
  }

  // ---- helpers ----

  Future<void> _waitUntilQuiet() async {
    while (_isSpeaking) {
      await Future.delayed(const Duration(milliseconds: 50));
    }
  }

  void _setAppState(AppState appState) {
    state = AsyncData(state.valueOrNull!.copyWith(appState: appState));
  }
}
