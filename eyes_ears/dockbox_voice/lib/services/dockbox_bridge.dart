import 'dart:async';

import 'dockbox_api_service.dart';

/// Consumes the SSE notification stream and dispatches text chunks and
/// turn-end signals. Mirrors the Python `DockboxBridge` from core/assistant.py.
class DockboxBridge {
  final DockboxApiService _api;
  StreamSubscription<Map<String, dynamic>>? _sseSubscription;

  /// Called with each speakable text chunk from the agent.
  void Function(String chunk)? onChunk;

  /// Called when the server signals end-of-turn.
  void Function()? onTurnEnd;

  // ANSI dim tracking (spans events)
  bool _dimActive = false;
  bool _inToolResult = false;

  DockboxBridge(this._api);

  void start() {
    _sseSubscription?.cancel();
    _sseSubscription = _api.streamNotifications().listen(_handleEvent);
  }

  void stop() {
    _sseSubscription?.cancel();
    _sseSubscription = null;
  }

  void _handleEvent(Map<String, dynamic> event) {
    final type = (event['type'] ?? '').toString().toLowerCase();

    if (type == 'connected' || type == 'ping' || type == 'keepalive') {
      return;
    }

    if (type == 'agent_activity') {
      final line = (event['line'] ?? '').toString();

      // Reset dim/tool-result state on new iterations
      if (line.contains('Entering tool loop') ||
          line.contains('Tool iteration')) {
        _dimActive = false;
        _inToolResult = false;
      }

      final text = _filterAgentLine(line);
      if (text.isNotEmpty) {
        onChunk?.call(text);
      }

      if (line.contains('Query complete') ||
          line.contains('Exited tool loop')) {
        _dimActive = false;
        _inToolResult = false;
        onTurnEnd?.call();
      }
      return;
    }

    if (type == 'done' ||
        type == 'turn_end' ||
        type == 'complete' ||
        type == 'agent_done' ||
        type == 'chat_complete') {
      _dimActive = false;
      _inToolResult = false;

      final message = (event['message'] ?? '').toString().trim();
      if (message.isNotEmpty) {
        onChunk?.call(message);
      }
      onTurnEnd?.call();
    }
  }

  /// Filter an agent_activity line down to spoken response text.
  /// Ported from `_filter_agent_line` in core/assistant.py.
  String _filterAgentLine(String line) {
    if (line.startsWith('[agent-runner]')) {
      _inToolResult = false;
      return '';
    }
    if (_inToolResult) return '';

    if (line.startsWith('{"model"') ||
        line.startsWith('{"id"') ||
        line.startsWith('{"role"')) {
      return '';
    }

    final stripped = line.trimLeft();
    if (stripped.startsWith('🤔') ||
        stripped.startsWith('────') ||
        stripped.startsWith('🔧')) {
      return '';
    }
    if (stripped.startsWith('→')) return '';

    if (stripped.startsWith('✅') ||
        stripped.startsWith('❌') ||
        stripped.startsWith('⚠️')) {
      _inToolResult = true;
      return '';
    }

    // Container log lines
    if (_isContainerLog(stripped)) return '';

    // Strip ANSI dim escapes
    return _stripAnsiDim(line);
  }

  static bool _isContainerLog(String line) {
    // Matches [start-services] or ENV_VAR= patterns
    if (line.startsWith('[') && line.contains(']') && line.length < 60) {
      return true;
    }
    if (RegExp(r'^[A-Z][A-Z0-9_]*=').hasMatch(line)) return true;
    return false;
  }

  String _stripAnsiDim(String line) {
    final out = StringBuffer();
    int pos = 0;
    while (pos < line.length) {
      final esc = line.indexOf('\x1b', pos);
      if (esc < 0) {
        if (!_dimActive) out.write(line.substring(pos));
        break;
      }
      if (esc > pos && !_dimActive) {
        out.write(line.substring(pos, esc));
      }
      final end = line.indexOf('m', esc);
      if (end < 0) break;
      final code = line.substring(esc, end + 1);
      if (code == '\x1b[2m') {
        _dimActive = true;
      } else if (code == '\x1b[0m') {
        _dimActive = false;
      }
      pos = end + 1;
    }
    return out.toString();
  }
}
