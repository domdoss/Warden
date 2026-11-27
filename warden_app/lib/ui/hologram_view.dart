import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// The full Three.js hologram (assets/jarvis.html). Owns its own frame loop;
/// we only push *coalesced* state + voice-level updates over the JS bridge, and
/// never rebuild this widget on level ticks (that's what caused the jank).
class HologramView extends StatefulWidget {
  final String state; // base: idle | listening | processing | error
  final ValueListenable<double> level; // 0..1.5 voice amplitude
  final VoidCallback? onTap;

  const HologramView({
    super.key,
    required this.state,
    required this.level,
    this.onTap,
  });

  @override
  State<HologramView> createState() => _HologramViewState();
}

class _HologramViewState extends State<HologramView> {
  WebViewController? _controller;
  bool _ready = false;
  String _pushedState = '';
  double _pushedLevel = -1;
  double _pendingLevel = 0;
  bool _levelDirty = false;
  Timer? _flushTimer;

  @override
  void initState() {
    super.initState();
    widget.level.addListener(_onLevel);
    _init();
  }

  Future<void> _init() async {
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0x00000000))
      ..addJavaScriptChannel('DockboxVoice', onMessageReceived: (m) {
        try {
          final d = jsonDecode(m.message) as Map<String, dynamic>;
          if (d['method'] == 'button_press') widget.onTap?.call();
        } catch (_) {}
      })
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) {
            _ready = true;
            _pushedState = '';
            _pushedLevel = -1;
            _flush();
          },
        ),
      )
      ..loadFlutterAsset('assets/jarvis.html');
  }

  void _onLevel() {
    _pendingLevel = widget.level.value;
    _levelDirty = true;
    _flushTimer ??= Timer.periodic(const Duration(milliseconds: 90), (_) => _flush());
  }

  String get _effectiveState {
    if (_pendingLevel > 0.06 && widget.state == 'idle') return 'speaking';
    return widget.state;
  }

  void _flush() {
    if (!_ready || _controller == null) return;

    final st = _effectiveState;
    if (st != _pushedState) {
      _pushedState = st;
      _controller!.runJavaScript('jarvis.setState("$st");');
    }

    if (_levelDirty) {
      final lvl = _pendingLevel;
      if ((lvl - _pushedLevel).abs() > 0.04) {
        _levelDirty = false;
        _pushedLevel = lvl;
        _controller!.runJavaScript(
            'jarvis.setAudioLevel(${(lvl * 2.0).clamp(0.0, 2.0).toStringAsFixed(3)});');
      }
    }
  }

  @override
  void didUpdateWidget(HologramView old) {
    super.didUpdateWidget(old);
    if (old.level != widget.level) {
      old.level.removeListener(_onLevel);
      widget.level.addListener(_onLevel);
    }
    if (widget.state != old.state) {
      _flush();
    }
  }

  @override
  void dispose() {
    widget.level.removeListener(_onLevel);
    _flushTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = _controller;
    if (c == null) return const SizedBox.expand();
    return WebViewWidget(controller: c);
  }
}
