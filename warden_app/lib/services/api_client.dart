import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';

import '../config/app_config.dart';
import '../models/models.dart';

String _s(dynamic v, [String fallback = '']) => v == null ? fallback : v.toString();

/// One SSE event from the /api/notifications broadcast stream.
class ChatEvent {
  final String type;
  final String line;
  final String message;
  const ChatEvent({this.type = '', this.line = '', this.message = ''});

  factory ChatEvent.fromJson(Map<String, dynamic> m) => ChatEvent(
        type: _s(m['type']).toLowerCase(),
        line: _s(m['line'] ?? m['text']),
        message: _s(m['message']),
      );
}

/// HTTP + SSE client for the Warden server. Single-user, no auth — the trust
/// boundary is the tailnet.
class ApiClient {
  ApiClient(String baseUrl)
      : _dio = Dio(BaseOptions(
          baseUrl: baseUrl,
          connectTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 40),
          followRedirects: true,
        ));

  final Dio _dio;

  String get baseUrl => _dio.options.baseUrl;

  // ---------- health / status ----------

  Future<bool> health() async {
    try {
      final r = await _dio.get('/api/health');
      return r.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  Future<Map<String, dynamic>> status() async =>
      _map(await _dio.get('/api/status'));

  // ---------- chat ----------

  Future<List<ChatMessage>> messages({int limit = 200}) async {
    final r = await _dio.get('/api/messages',
        queryParameters: {'limit': limit});
    final data = r.data is Map ? r.data as Map : <String, dynamic>{};
    final list = (data['messages'] as List?) ?? const [];
    return list
        .whereType<Map>()
        .map((m) => ChatMessage.fromJson(Map<String, dynamic>.from(m)))
        .toList();
  }

  Future<void> sendMessage(String text, {String? model}) async {
    await _dio.post('/api/messages', data: {
      'text': text,
      'sender_name': AppConfig.senderName,
      if (model != null) 'model': model,
    });
  }

  Future<void> stopChat() async {
    try {
      await _dio.post('/api/chat/stop');
    } catch (_) {}
  }

  Future<void> clearConversation() async {
    try {
      await _dio.post('/api/chat/clear-conversation');
    } catch (_) {}
  }

  /// SSE stream with reconnect/backoff.
  Stream<ChatEvent> notifications() async* {
    var backoff = 1.0;
    while (true) {
      try {
        yield* _sse();
        backoff = 1.0;
      } catch (_) {
        await Future<void>.delayed(Duration(seconds: backoff.toInt()));
        backoff = (backoff * 2).clamp(1.0, 30.0).toDouble();
      }
    }
  }

  Stream<ChatEvent> _sse() async* {
    final resp = await _dio.get<ResponseBody>(
      '/api/notifications',
      options: Options(
        responseType: ResponseType.stream,
        headers: {'Accept': 'text/event-stream'},
      ),
    );
    final stream = resp.data!.stream;
    String buffer = '';
    await for (final chunk in stream) {
      buffer += utf8.decode(chunk);
      while (buffer.contains('\n\n')) {
        final idx = buffer.indexOf('\n\n');
        final evt = buffer.substring(0, idx);
        buffer = buffer.substring(idx + 2);
        final dataLine = evt
            .split('\n')
            .firstWhere((l) => l.startsWith('data:'), orElse: () => '');
        if (dataLine.isEmpty) continue;
        final jsonStr = dataLine.substring(5).trim();
        if (jsonStr.isEmpty) continue;
        try {
          final m = jsonDecode(jsonStr);
          if (m is Map) yield ChatEvent.fromJson(Map<String, dynamic>.from(m));
        } catch (_) {}
      }
    }
  }

  // ---------- BBS ----------

  Future<Map<String, dynamic>> bbsState({String? board}) async =>
      _map(await _dio.get('/api/friends/bbs',
          queryParameters: {if (board != null) 'board': board}));

  Future<Map<String, dynamic>> bbsBoards() async =>
      _map(await _dio.get('/api/friends/bbs/boards'));

  Future<Map<String, dynamic>> bbsThread(String id) async =>
      _map(await _dio.get('/api/friends/bbs/thread/${Uri.encodeComponent(id)}'));

  Future<Map<String, dynamic>> bbsPost(Map<String, dynamic> body) async =>
      _map(await _dio.post('/api/friends/bbs/new', data: body));

  Future<Map<String, dynamic>> bbsFileRead(String name) async =>
      _map(await _dio
          .get('/api/friends/bbs/file/${Uri.encodeComponent(name)}'));

  Future<Map<String, dynamic>> bbsFileSave(String name, String content) async =>
      _map(await _dio.post('/api/friends/bbs/file-save',
          data: {'name': name, 'content': content}));

  Future<Map<String, dynamic>> bbsFileDelete(String name) async =>
      _map(await _dio.post('/api/friends/bbs/file-delete', data: {'name': name}));

  Future<Map<String, dynamic>> bbsMail() async =>
      _map(await _dio.get('/api/friends/bbs/mail'));

  Future<Map<String, dynamic>> dm(String hostname, String message) async =>
      _map(await _dio.post('/api/friends/dm',
          data: {'hostname': hostname, 'message': message}));

  Future<Map<String, dynamic>> bbsBulletins() async =>
      _map(await _dio.get('/api/friends/bbs/bulletins'));

  Future<Map<String, dynamic>> bbsAddBulletin(String title, String body) async =>
      _map(await _dio.post('/api/friends/bbs/bulletins',
          data: {'title': title, 'body': body}));

  Future<Map<String, dynamic>> bbsDoors() async =>
      _map(await _dio.get('/api/friends/bbs/doors'));

  Future<String> bbsDoorHtml(String name) async {
    final r = await _dio.get('/api/friends/bbs/door/${Uri.encodeComponent(name)}',
        options: Options(responseType: ResponseType.plain));
    return r.data.toString();
  }

  Future<Map<String, dynamic>> bbsUsers() async =>
      _map(await _dio.get('/api/friends/bbs/users'));

  Future<Map<String, dynamic>> bbsProfile(String handle) async =>
      _map(await _dio.get('/api/friends/bbs/profile',
          queryParameters: {'handle': handle}));

  Future<Map<String, dynamic>> bbsProfileSave(
          String handle, String name, String bio) async =>
      _map(await _dio.post('/api/friends/bbs/profile',
          data: {'handle': handle, 'name': name, 'bio': bio}));

  Future<Map<String, dynamic>> bbsCapabilities(String q) async =>
      _map(await _dio.get('/api/friends/bbs/capabilities',
          queryParameters: {'q': q}));

  Future<Map<String, dynamic>> bbsDial(String host) async =>
      _map(await _dio.get('/api/friends/bbs/dial/${Uri.encodeComponent(host)}'));

  // ---------- shared file area (mesh) ----------

  Future<List<BbsFile>> bbsFiles() async {
    final r = await _dio.get('/api/friends/bbs');
    final data = r.data is Map ? r.data as Map : <String, dynamic>{};
    final list = (data['files'] as List?) ?? const [];
    return list
        .whereType<Map>()
        .map((m) => BbsFile.fromJson(Map<String, dynamic>.from(m)))
        .toList();
  }

  Future<Map<String, dynamic>> bbsFileUpload(String name, List<int> bytes) async =>
      _map(await _dio.post('/api/friends/bbs/file-upload',
          data: {'name': name, 'data_base64': base64Encode(bytes)}));

  // ---------- workspace files ----------

  Future<List<WorkspaceEntry>> filesList(String path) async {
    final r = await _dio.get('/api/files/list',
        queryParameters: {'path': path});
    final list = (r.data is List) ? r.data as List : const [];
    return list
        .whereType<Map>()
        .map((m) => WorkspaceEntry.fromJson(Map<String, dynamic>.from(m)))
        .toList();
  }

  Future<Map<String, dynamic>> filesRead(String path) async =>
      _map(await _dio.get('/api/files/read', queryParameters: {'path': path}));

  // ---------- tasks / calendar / alarms ----------

  Future<List<Task>> tasks() async {
    final r = await _dio.get('/api/tasks');
    final data = r.data is Map ? r.data as Map : <String, dynamic>{};
    final list = (data['tasks'] as List?) ?? const [];
    return list
        .whereType<Map>()
        .map((m) => Task.fromJson(Map<String, dynamic>.from(m)))
        .toList();
  }

  Future<Map<String, dynamic>> addTask(Map<String, dynamic> body) async =>
      _map(await _dio.post('/api/tasks', data: body));

  Future<Map<String, dynamic>> updateTaskStatus(String id, String status) async =>
      _map(await _dio.patch('/api/tasks/${Uri.encodeComponent(id)}',
          data: {'status': status}));

  Future<Map<String, dynamic>> deleteTask(String id) async =>
      _map(await _dio.delete('/api/tasks/${Uri.encodeComponent(id)}'));

  Future<List<Alarm>> alarms() async {
    final r = await _dio.get('/api/alarms');
    final data = r.data is Map ? r.data as Map : <String, dynamic>{};
    final list = (data['alarms'] as List?) ?? const [];
    return list
        .whereType<Map>()
        .map((m) => Alarm.fromJson(Map<String, dynamic>.from(m)))
        .toList();
  }

  Future<Map<String, dynamic>> addAlarm(Map<String, dynamic> body) async =>
      _map(await _dio.post('/api/alarms', data: body));

  Future<Map<String, dynamic>> updateAlarm(String id, Map<String, dynamic> body) async =>
      _map(await _dio.put('/api/alarms/${Uri.encodeComponent(id)}', data: body));

  Future<List<CalendarEvent>> calendarEvents() async {
    final r = await _dio.get('/api/calendar/events');
    final data = r.data is Map ? r.data as Map : <String, dynamic>{};
    final list = (data['events'] as List?) ?? const [];
    return list
        .whereType<Map>()
        .map((m) => CalendarEvent.fromJson(Map<String, dynamic>.from(m)))
        .toList();
  }

  Future<Map<String, dynamic>> addCalendarEvent(Map<String, dynamic> body) async =>
      _map(await _dio.post('/api/calendar/events', data: body));

  Future<Map<String, dynamic>> deleteCalendarEvent(String id) async =>
      _map(await _dio.delete('/api/calendar/events/${Uri.encodeComponent(id)}'));

  // ---------- projects ----------

  Future<List<Project>> projects() async {
    final r = await _dio.get('/api/projects');
    final data = r.data is Map ? r.data as Map : <String, dynamic>{};
    final list = (data['projects'] as List?) ?? const [];
    return list
        .whereType<Map>()
        .map((m) => Project.fromJson(Map<String, dynamic>.from(m)))
        .toList();
  }

  Future<Map<String, dynamic>> addProject(Map<String, dynamic> body) async =>
      _map(await _dio.post('/api/projects', data: body));

  Future<Map<String, dynamic>> deleteProject(String id) async =>
      _map(await _dio.delete('/api/projects/${Uri.encodeComponent(id)}'));

  Future<Map<String, dynamic>> projectDetail(String id) async =>
      _map(await _dio.get('/api/projects/${Uri.encodeComponent(id)}'));

  // ---------- email ----------

  Future<List<dynamic>> emailAccounts() async {
    final r = await _dio.get('/api/email/accounts');
    final data = r.data;
    if (data is Map) return (data['accounts'] as List?) ?? const [];
    if (data is List) return data;
    return const [];
  }

  Future<List<EmailItem>> emailInbox(String accountId,
      {String folder = 'INBOX', int limit = 50}) async {
    final r = await _dio.get('/api/email/inbox', queryParameters: {
      'accountId': accountId,
      'folder': folder,
      'limit': limit,
    });
    final data = r.data is Map ? r.data as Map : <String, dynamic>{};
    final list = (data['emails'] as List?) ?? const [];
    return list
        .whereType<Map>()
        .map((m) => EmailItem.fromJson(Map<String, dynamic>.from(m)))
        .toList();
  }

  Future<Map<String, dynamic>> emailMessage(String accountId, String emailId) async =>
      _map(await _dio.get('/api/email/message',
          queryParameters: {'accountId': accountId, 'emailId': emailId}));

  Future<Map<String, dynamic>> emailSend(Map<String, dynamic> body) async =>
      _map(await _dio.post('/api/email/send', data: body));

  // ---------- friends / heartbeat ----------

  Future<Map<String, dynamic>> friends() async =>
      _map(await _dio.get('/api/friends'));

  Future<Map<String, dynamic>> friendsInvite(String hostname) async =>
      _map(await _dio.post('/api/friends/invite-send',
          data: {'hostname': hostname}));

  Future<Map<String, dynamic>> friendsAccept(String host) async => _map(
      await _dio.post('/api/friends/requests/${Uri.encodeComponent(host)}/accept'));

  Future<Map<String, dynamic>> friendsDeny(String host) async => _map(
      await _dio.post('/api/friends/requests/${Uri.encodeComponent(host)}/deny'));

  Future<Map<String, dynamic>> friendsPing(String host) async => _map(
      await _dio.post('/api/friends/${Uri.encodeComponent(host)}/ping'));

  Future<Map<String, dynamic>> friendsRemove(String host) async => _map(
      await _dio.delete('/api/friends/${Uri.encodeComponent(host)}'));

  Future<Map<String, dynamic>> friendsBlock(String host, String reason) async =>
      _map(await _dio.post('/api/friends/${Uri.encodeComponent(host)}/block',
          data: {'reason': reason}));

  Future<Map<String, dynamic>> friendsUnblock(String host) async => _map(
      await _dio.post('/api/friends/${Uri.encodeComponent(host)}/unblock'));

  Future<Map<String, dynamic>> heartbeat() async =>
      _map(await _dio.get('/api/heartbeat'));

  Future<Map<String, dynamic>> heartbeatUpdate(Map<String, dynamic> body) async =>
      _map(await _dio.put('/api/heartbeat', data: body));

  // ---------- settings / models ----------

  Future<Map<String, dynamic>> settings() async =>
      _map(await _dio.get('/api/settings'));

  Future<Map<String, dynamic>> saveSettings(Map<String, dynamic> body) async =>
      _map(await _dio.post('/api/settings', data: body));

  // ---------- training loop (audit → modify → train) ----------

  Future<Map<String, dynamic>> trainingStatus() async => _map(await _dio
      .get('/api/training/status', queryParameters: {'group': 'loop'}));

  Future<Map<String, dynamic>> trainingModels() async =>
      _map(await _dio.get('/api/training/models'));

  Future<Map<String, dynamic>> trainingSetModel(String model) async =>
      _map(await _dio.post('/api/training/model', data: {'model': model}));

  Future<Map<String, dynamic>> trainingAudit(int days) async =>
      _map(await _dio.post('/api/training/audit', data: {'days': days}));

  Future<Map<String, dynamic>> trainingModify() async =>
      _map(await _dio.post('/api/training/modify'));

  Future<Map<String, dynamic>> trainingTrain() async =>
      _map(await _dio.post('/api/training/train'));

  Future<Map<String, dynamic>> trainingStop() async =>
      _map(await _dio.post('/api/training/stop'));

  Future<Map<String, dynamic>> trainingFlags() async =>
      _map(await _dio.get('/api/training/flags'));

  Future<Map<String, dynamic>> trainingAddFlag(Map<String, dynamic> body) async =>
      _map(await _dio.post('/api/training/flag', data: body));

  /// Every selectable model, un-capped: all Ollama tags, the cloud models,
  /// friendly-name keys, and any model the role/training config already uses.
  Future<List<String>> allModels() async {
    final set = <String>{};
    void addAll(dynamic v) {
      if (v is List) {
        for (final e in v) {
          final s = e.toString().trim();
          if (s.isNotEmpty) set.add(s);
        }
      }
    }

    try {
      final d = _map(await _dio.get('/api/ollama/test'));
      addAll(d['models']);
      addAll(d['cloudModels']);
      final friendly = d['friendlyNames'];
      if (friendly is Map) {
        for (final k in friendly.keys) {
          final s = k.toString().trim();
          if (s.isNotEmpty) set.add(s);
        }
      }
    } catch (_) {}
    try {
      final t = await trainingModels();
      addAll(t['models']);
      final cur = t['current'];
      if (cur is String && cur.trim().isNotEmpty) set.add(cur.trim());
    } catch (_) {}
    return set.toList()..sort();
  }

  // ---------- image generation ----------

  /// Generate an image on the host (local SD.cpp). The host composes the final
  /// photoreal prompt from these fields and runs generate.sh, returning the
  /// served PNG under `url` (absolute or host-relative).
  Future<Map<String, dynamic>> imageGen({
    required String prompt,
    String? scene,
    String? aesthetic,
    String? location,
    String? negative,
    int? width,
    int? height,
    int? seed,
  }) async =>
      _map(await _dio.post('/api/imagegen', data: {
        'prompt': prompt,
        if (scene != null && scene.trim().isNotEmpty) 'scene': scene.trim(),
        if (aesthetic != null && aesthetic.trim().isNotEmpty)
          'aesthetic': aesthetic.trim(),
        if (location != null && location.trim().isNotEmpty)
          'location': location.trim(),
        if (negative != null && negative.trim().isNotEmpty)
          'negative': negative.trim(),
        if (width != null) 'width': width,
        if (height != null) 'height': height,
        if (seed != null) 'seed': seed,
      }));

  /// Current image-gen job state: {ok, running, name?, url?, error?}. The POST
  /// starts the render and returns immediately; poll this until `running` is
  /// false — no request timeout bounds a slow render.
  Future<Map<String, dynamic>> imageGenStatus() async =>
      _map(await _dio.get('/api/imagegen/status'));

  /// Recent generated images (newest first). Each entry has `name`, `url`,
  /// `mtime`, `size`; `url` is host-relative (`/api/imagegen/file/<name>`).
  Future<List<Map<String, dynamic>>> imageGenHistory() async {
    final d = _map(await _dio.get('/api/imagegen/history'));
    final files = (d['files'] as List?) ?? const [];
    return files
        .whereType<Map>()
        .map((m) => Map<String, dynamic>.from(m))
        .toList();
  }

  // ---------- helpers ----------

  /// Fire-and-forget diagnostic report to the server log.
  Future<void> reportDebug(String tag, Map<String, dynamic> data) async {
    try {
      await _dio.post('/api/debug-log', data: {'tag': tag, 'data': data});
    } catch (_) {}
  }

  static Map<String, dynamic> _map(Response<dynamic> r) =>
      r.data is Map ? (r.data as Map).cast<String, dynamic>() : <String, dynamic>{};
}
