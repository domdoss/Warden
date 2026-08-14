import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';

/// HTTP + SSE client for the Dockbox server.
///
/// Mirrors the Python `DockboxClient` from core/dockbox_client.py.
class DockboxApiService {
  final String baseUrl;
  late final Dio _dio;

  DockboxApiService({required this.baseUrl}) {
    _dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
      followRedirects: true,
    ));
  }

  void updateBaseUrl(String url) {
    _dio.options.baseUrl = url;
  }

  // ---------- health ----------

  Future<Map<String, dynamic>> health() async {
    final resp = await _dio.get('/api/health');
    return _json(resp);
  }

  // ---------- messaging ----------

  Future<Map<String, dynamic>> sendMessage({
    required String text,
    required String jid,
    String? senderName,
    String? model,
  }) async {
    final body = <String, dynamic>{
      'text': text,
      'jid': jid,
    };
    if (senderName != null) body['sender_name'] = senderName;
    if (model != null) body['model'] = model;

    final resp = await _dio.post('/api/messages', data: body);
    return _json(resp);
  }

  // ---------- stop ----------

  Future<void> stopChat() async {
    await _dio.post('/api/chat/stop');
  }

  // ---------- SSE notifications ----------

  /// Streams SSE events from /api/notifications with exponential backoff
  /// reconnection. Mirrors the Python `stream_notifications`.
  Stream<Map<String, dynamic>> streamNotifications() async* {
    double backoff = 1.0;
    while (true) {
      try {
        yield* _connectSSE();
        backoff = 1.0;
      } on DioException catch (e) {
        print('[dockbox] SSE disconnected: $e; reconnecting in ${backoff}s');
        await Future.delayed(Duration(seconds: backoff.toInt()));
        backoff = (backoff * 2).clamp(0, 30);
      }
    }
  }

  Stream<Map<String, dynamic>> _connectSSE() async* {
    final response = await _dio.get(
      '/api/notifications',
      options: Options(
        responseType: ResponseType.stream,
        headers: {'Accept': 'text/event-stream'},
      ),
    );

    final stream = response.data.stream as Stream<List<int>>;
    String buffer = '';

    await for (final chunk in stream) {
      buffer += utf8.decode(chunk);
      while (buffer.contains('\n\n')) {
        final idx = buffer.indexOf('\n\n');
        final event = buffer.substring(0, idx);
        buffer = buffer.substring(idx + 2);

        if (event.startsWith('data: ')) {
          final jsonStr = event.substring(6).trim();
          if (jsonStr.isEmpty) continue;
          try {
            yield jsonDecode(jsonStr) as Map<String, dynamic>;
          } catch (_) {
            // Skip unparseable events
          }
        }
      }
    }
  }

  // ---------- helpers ----------

  static Map<String, dynamic> _json(Response resp) {
    return resp.data is Map<String, dynamic>
        ? resp.data as Map<String, dynamic>
        : <String, dynamic>{};
  }

  void close() {
    _dio.close();
  }
}
