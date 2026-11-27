/// Domain models for the Warden mobile app. Parsed defensively from the
/// Warden REST API so a missing field never crashes a screen.

String _s(dynamic v, [String fallback = '']) => v == null ? fallback : v.toString();
int _i(dynamic v, [int fallback = 0]) {
  if (v == null) return fallback;
  if (v is int) return v;
  return int.tryParse(v.toString()) ?? fallback;
}

bool _b(dynamic v, [bool fallback = false]) {
  if (v == null) return fallback;
  if (v is bool) return v;
  if (v is num) return v != 0;
  final s = v.toString().toLowerCase();
  return s == 'true' || s == '1';
}

// ---- chat ----

class ChatMessage {
  final String id;
  final bool fromUser; // true = the human, false = the assistant
  final String content;
  final DateTime? timestamp;

  const ChatMessage({
    required this.id,
    required this.fromUser,
    required this.content,
    this.timestamp,
  });

  factory ChatMessage.fromJson(Map<String, dynamic> m) {
    final sender = _s(m['sender']).toLowerCase();
    final isFromMe = _b(m['is_from_me']);
    final isBot = _b(m['is_bot_message']);
    final bool fromUser;
    if (sender == 'user' ||
        sender == 'dashboard' ||
        sender == 'owner' ||
        sender == 'admin' ||
        sender == 'web') {
      fromUser = true;
    } else if (sender == 'assistant' || sender.startsWith('assistant')) {
      fromUser = false;
    } else {
      fromUser = isFromMe && !isBot;
    }
    final ts = m['timestamp'] ?? m['created_at'];
    DateTime? time;
    if (ts != null) {
      time = DateTime.tryParse(ts.toString())?.toLocal();
    }
    return ChatMessage(
      id: _s(m['id'], DateTime.now().microsecondsSinceEpoch.toString()),
      fromUser: fromUser,
      content: _s(m['content'] ?? m['text']),
      timestamp: time,
    );
  }
}

// ---- BBS ----

class Board {
  final String name;
  final String description;
  final int position;
  const Board({required this.name, required this.description, this.position = 0});

  factory Board.fromJson(Map<String, dynamic> m) => Board(
        name: _s(m['name']),
        description: _s(m['description'] ?? m['desc']),
        position: _i(m['position']),
      );
}

class Thread {
  final String id;
  final String title;
  final String board;
  final String host;
  final int posts;
  final DateTime? updated;
  const Thread({
    required this.id,
    required this.title,
    this.board = '',
    this.host = '',
    this.posts = 0,
    this.updated,
  });

  factory Thread.fromJson(Map<String, dynamic> m) {
    final u = m['created_at'] ?? m['updated'] ?? m['created'] ?? m['ts'];
    return Thread(
      id: _s(m['id'] ?? m['thread_id']),
      title: _s(m['title']),
      board: _s(m['board']),
      host: _s(m['host']),
      posts: _i(m['post_count'] ?? m['posts'] ?? m['count'] ?? m['replies']),
      updated: u == null ? null : DateTime.tryParse(u.toString())?.toLocal(),
    );
  }
}

class Post {
  final String id;
  final String threadId;
  final String board;
  final String title;
  final String body;
  final String author;
  final String host;
  final DateTime? created;
  const Post({
    required this.id,
    required this.body,
    this.threadId = '',
    this.board = '',
    this.title = '',
    this.author = '',
    this.host = '',
    this.created,
  });

  factory Post.fromJson(Map<String, dynamic> m) {
    final c = m['created'] ?? m['created_at'] ?? m['ts'] ?? m['timestamp'];
    return Post(
      id: _s(m['id'] ?? m['post_id']),
      threadId: _s(m['thread_id']),
      board: _s(m['board']),
      title: _s(m['title']),
      body: _s(m['body'] ?? m['content']),
      author: _s(m['author_host'] ?? m['author'] ?? m['author_kind']),
      host: _s(m['host']),
      created: c == null ? null : DateTime.tryParse(c.toString())?.toLocal(),
    );
  }
}

class BbsFile {
  final String name;
  final int size;
  final DateTime? mtime;
  const BbsFile({required this.name, this.size = 0, this.mtime});

  factory BbsFile.fromJson(Map<String, dynamic> m) => BbsFile(
        name: _s(m['name']),
        size: _i(m['size'] ?? m['size_bytes']),
        mtime: m['mtime'] == null
            ? null
            : DateTime.fromMillisecondsSinceEpoch(
                (double.parse(m['mtime'].toString()) * 1000).toInt()),
      );
}

// ---- mail ----

class MailMessage {
  final String id;
  final String from;
  final String to;
  final String body;
  final bool read;
  final DateTime? at;
  const MailMessage({
    required this.id,
    required this.body,
    this.from = '',
    this.to = '',
    this.read = false,
    this.at,
  });

  factory MailMessage.fromJson(Map<String, dynamic> m) {
    final t = m['at'] ?? m['created'] ?? m['timestamp'];
    return MailMessage(
      id: _s(m['id'] ?? m['message_id']),
      from: _s(m['from'] ?? m['from_host'] ?? m['sender']),
      to: _s(m['to'] ?? m['to_host']),
      body: _s(m['message'] ?? m['body'] ?? m['content']),
      read: _b(m['read']),
      at: t == null ? null : DateTime.tryParse(t.toString())?.toLocal(),
    );
  }
}

class Mention {
  final String id;
  final String body;
  final String postId;
  final bool unread;
  final DateTime? at;
  const Mention({
    required this.id,
    required this.body,
    this.postId = '',
    this.unread = false,
    this.at,
  });

  factory Mention.fromJson(Map<String, dynamic> m) {
    final t = m['at'] ?? m['created'] ?? m['ts'];
    return Mention(
      id: _s(m['id'] ?? m['mention_id']),
      body: _s(m['body'] ?? m['excerpt']),
      postId: _s(m['post_id']),
      unread: _b(m['unread'], true),
      at: t == null ? null : DateTime.tryParse(t.toString())?.toLocal(),
    );
  }
}

// ---- misc ----

class Bulletin {
  final String id;
  final String title;
  final String body;
  final DateTime? at;
  const Bulletin({required this.id, required this.title, required this.body, this.at});

  factory Bulletin.fromJson(Map<String, dynamic> m) {
    final t = m['at'] ?? m['created'] ?? m['timestamp'];
    return Bulletin(
      id: _s(m['id']),
      title: _s(m['title']),
      body: _s(m['body'] ?? m['text']),
      at: t == null ? null : DateTime.tryParse(t.toString())?.toLocal(),
    );
  }
}

class Door {
  final String name;
  final String desc;
  final String file;
  const Door({required this.name, this.desc = '', this.file = ''});

  factory Door.fromJson(Map<String, dynamic> m) => Door(
        name: _s(m['name']),
        desc: _s(m['desc'] ?? m['description']),
        file: _s(m['file']),
      );
}

class BbsUser {
  final String handle;
  final String level;
  final DateTime? created;
  const BbsUser({required this.handle, this.level = 'caller', this.created});

  factory BbsUser.fromJson(Map<String, dynamic> m) {
    final c = m['created'] ?? m['created_at'];
    return BbsUser(
      handle: _s(m['handle'] ?? m['name']),
      level: _s(m['level']),
      created: c == null ? null : DateTime.tryParse(c.toString())?.toLocal(),
    );
  }
}

class Profile {
  final String handle;
  final String name;
  final String bio;
  final String level;
  final String joined;
  const Profile({
    required this.handle,
    this.name = '',
    this.bio = '',
    this.level = 'caller',
    this.joined = '',
  });

  factory Profile.fromJson(Map<String, dynamic> m) => Profile(
        handle: _s(m['handle']),
        name: _s(m['name']),
        bio: _s(m['bio']),
        level: _s(m['level']),
        joined: _s(m['joined']),
      );
}

// ---- workspace files ----

class WorkspaceEntry {
  final String name;
  final bool isDir;
  final int size;
  final DateTime? mtime;
  const WorkspaceEntry({
    required this.name,
    required this.isDir,
    this.size = 0,
    this.mtime,
  });

  factory WorkspaceEntry.fromJson(Map<String, dynamic> m) => WorkspaceEntry(
        name: _s(m['name']),
        isDir: _s(m['type']) == 'dir',
        size: _i(m['size_bytes']),
        mtime: m['mtime'] == null
            ? null
            : DateTime.fromMillisecondsSinceEpoch(
                (double.parse(m['mtime'].toString()) * 1000).toInt()),
      );
}

// ---- tasks / calendar / alarms ----

class Task {
  final String id;
  final String title;
  final String status;
  final String scheduleType;
  final String schedule;
  final DateTime? lastRun;
  final DateTime? nextRun;
  final DateTime? due;
  const Task({
    required this.id,
    required this.title,
    this.status = '',
    this.scheduleType = '',
    this.schedule = '',
    this.lastRun,
    this.nextRun,
    this.due,
  });

  factory Task.fromJson(Map<String, dynamic> m) {
    final lr = m['last_run'];
    final nx = m['next_run'];
    final d = m['due'] ?? m['due_date'];
    return Task(
      id: _s(m['id']),
      title: _s(m['title'] ?? m['prompt'] ?? m['label'] ?? m['name']),
      status: _s(m['status']),
      scheduleType: _s(m['schedule_type']),
      schedule: _s(m['schedule_value'] ?? m['schedule'] ?? m['cron']),
      lastRun: lr == null ? null : DateTime.tryParse(lr.toString())?.toLocal(),
      nextRun: nx == null ? null : DateTime.tryParse(nx.toString())?.toLocal(),
      due: d == null ? null : DateTime.tryParse(d.toString())?.toLocal(),
    );
  }
}

class Alarm {
  final String id;
  final String label;
  final String time;
  final String date;
  final String repeatType;
  final bool enabled;
  const Alarm({
    required this.id,
    required this.label,
    this.time = '',
    this.date = '',
    this.repeatType = '',
    this.enabled = true,
  });

  factory Alarm.fromJson(Map<String, dynamic> m) => Alarm(
        id: _s(m['id']),
        label: _s(m['label']),
        time: _s(m['alarm_time']),
        date: _s(m['alarm_date']),
        repeatType: _s(m['repeat_type']),
        enabled: _b(m['enabled'], true),
      );
}

class CalendarEvent {
  final String id;
  final String title;
  final String start;
  final String end;
  final String location;
  final bool allDay;
  const CalendarEvent({
    required this.id,
    required this.title,
    this.start = '',
    this.end = '',
    this.location = '',
    this.allDay = false,
  });

  factory CalendarEvent.fromJson(Map<String, dynamic> m) => CalendarEvent(
        id: _s(m['id']),
        title: _s(m['title']),
        start: _s(m['start_time'] ?? m['start']),
        end: _s(m['end_time'] ?? m['end']),
        location: _s(m['location']),
        allDay: _b(m['all_day']),
      );
}

// ---- projects ----

class Project {
  final String id;
  final String name;
  final String description;
  final String status;
  final String dueDate;
  const Project({
    required this.id,
    required this.name,
    this.description = '',
    this.status = '',
    this.dueDate = '',
  });

  factory Project.fromJson(Map<String, dynamic> m) => Project(
        id: _s(m['id']),
        name: _s(m['name']),
        description: _s(m['description']),
        status: _s(m['status']),
        dueDate: _s(m['due_date']),
      );
}

// ---- email ----

class EmailItem {
  final String id;
  final String from;
  final String subject;
  final DateTime? date;
  final bool unread;
  const EmailItem({
    required this.id,
    this.from = '',
    this.subject = '',
    this.date,
    this.unread = false,
  });

  factory EmailItem.fromJson(Map<String, dynamic> m) {
    final d = m['date'] ?? m['received_at'] ?? m['timestamp'];
    return EmailItem(
      id: _s(m['id'] ?? m['uid']),
      from: _s(m['from'] ?? m['sender']),
      subject: _s(m['subject']),
      date: d == null ? null : DateTime.tryParse(d.toString())?.toLocal(),
      unread: _b(m['unread']),
    );
  }
}

// ---- friends ----

class Friend {
  final String hostname;
  final bool online;
  final List<String> capabilities;
  final List<String> specialists;
  const Friend({
    required this.hostname,
    this.online = false,
    this.capabilities = const [],
    this.specialists = const [],
  });

  factory Friend.fromJson(Map<String, dynamic> m) {
    List<String> list(dynamic v) =>
        v is List ? v.map((e) => e.toString()).toList() : const [];
    return Friend(
      hostname: _s(m['id'] ?? m['hostname'] ?? m['name']),
      online: _s(m['status']) == 'online' || _b(m['online']),
      capabilities: list(m['capabilities']),
      specialists: list(m['specialists']),
    );
  }
}
