import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../models/app_state.dart';
import '../../providers/conversation_provider.dart';

/// Renders the original Three.js hologram via WebView.
class HologramWidget extends ConsumerStatefulWidget {
  const HologramWidget({super.key});

  @override
  ConsumerState<HologramWidget> createState() => _HologramWidgetState();
}

class _HologramWidgetState extends ConsumerState<HologramWidget> {
  WebViewController? _controller;
  AppState _lastState = AppState.idle;
  double _lastAudioLevel = 0.0;

  @override
  void initState() {
    super.initState();
    _initWebView();
  }

  Future<void> _initWebView() async {
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0x00000000))
      ..addJavaScriptChannel(
        'DockboxVoice',
        onMessageReceived: (message) {
          final data = jsonDecode(message.message) as Map<String, dynamic>;
          if (data['method'] == 'button_press') {
            ref.read(conversationProvider.notifier).handleInteraction();
          }
        },
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) {
            _syncState();
          },
        ),
      )
      ..loadFlutterAsset('assets/jarvis.html');
  }

  @override
  Widget build(BuildContext context) {
    final conv = ref.watch(conversationProvider);
    final appState = conv.valueOrNull?.appState ?? AppState.idle;
    final audioLevel = conv.valueOrNull?.audioLevel ?? 0.0;

    // Sync state to JS when it changes
    if (appState != _lastState) {
      _lastState = appState;
      _setJsState(appState);
    }
    if (audioLevel != _lastAudioLevel) {
      _lastAudioLevel = audioLevel;
      _setJsAudioLevel(audioLevel);
    }

    if (_controller == null) {
      return const SizedBox.expand();
    }

    return WebViewWidget(controller: _controller!);
  }

  void _setJsState(AppState state) {
    final name = state.name;
    _controller?.runJavaScript('jarvis.setState("$name");');
  }

  void _setJsAudioLevel(double level) {
    _controller?.runJavaScript('jarvis.setAudioLevel($level);');
  }

  void _syncState() {
    _controller?.runJavaScript('jarvis.setState("${_lastState.name}");');
    _controller?.runJavaScript('jarvis.setAudioLevel($_lastAudioLevel);');
  }
}
