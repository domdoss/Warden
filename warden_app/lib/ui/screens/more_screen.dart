import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../models/models.dart';
import '../../providers/providers.dart';
import '../../services/tailscale_service.dart';
import '../../theme.dart';
import 'settings_screen.dart';

class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final st =
        ref.watch(tailscaleStateProvider).valueOrNull ?? TailscaleState.stopped;
    final connected = st == TailscaleState.connected;
    final color = connected ? WardenColors.green : WardenColors.amber;

    return Scaffold(
      appBar: AppBar(title: const Text('More')),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          _StatusCard(connected: connected, color: color),
          const SizedBox(height: 8),
          _tile(context, ref, 'Settings', 'Tailscale, voice, identity',
              Icons.settings, SettingsScreen()),
          _tile(context, ref, 'Bulletins', 'Sysop announcements',
              Icons.campaign_outlined, const BulletinsScreen()),
          _tile(context, ref, 'Doors', 'Installed door games', Icons.extension,
              const DoorsScreen()),
          _tile(context, ref, 'Users', 'Telnet/console accounts', Icons.people,
              const UsersScreen()),
          _tile(context, ref, 'Profile', 'Your caller profile',
              Icons.person_outline, const ProfileScreen()),
          _tile(context, ref, 'Capabilities', 'What this node offers',
              Icons.auto_awesome, const CapabilitiesScreen()),
          _tile(context, ref, 'Dial-in', 'Dial a friend node',
              Icons.dialpad, const DialScreen()),
          _tile(context, ref, 'Status', 'System status', Icons.monitor_heart,
              const StatusScreen()),
        ],
      ),
    );
  }

  Widget _tile(BuildContext context, WidgetRef ref, String title,
      String subtitle, IconData icon, Widget page) {
    return ListTile(
      leading: Icon(icon, color: WardenColors.cyan),
      title: Text(title, style: const TextStyle(color: WardenColors.text)),
      subtitle: Text(subtitle,
          style: const TextStyle(color: WardenColors.textDim, fontSize: 12)),
      trailing: const Icon(Icons.chevron_right, color: WardenColors.textDim),
      onTap: () => Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => page)),
    );
  }
}

class _StatusCard extends StatelessWidget {
  final bool connected;
  final Color color;
  const _StatusCard({required this.connected, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: WardenColors.surface,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              connected
                  ? 'Connected to your Warden over Tailscale'
                  : 'Tailscale tunnel not connected',
              style: const TextStyle(color: WardenColors.text, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

// ---- Bulletins ----

final _bulletinsProvider =
    FutureProvider<Map<String, dynamic>>((ref) async {
  return ref.watch(apiProvider).bbsBulletins();
});

class BulletinsScreen extends ConsumerWidget {
  const BulletinsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final b = ref.watch(_bulletinsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Bulletins')),
      body: b.when(
        loading: () => const Center(
            child: CircularProgressIndicator(color: WardenColors.cyan)),
        error: (e, _) => Center(
            child: Text('$e', style: const TextStyle(color: WardenColors.textDim))),
        data: (d) {
          final list = (d['bulletins'] as List? ?? const [])
              .whereType<Map>()
              .map((m) => Bulletin.fromJson(Map<String, dynamic>.from(m)))
              .toList();
          if (list.isEmpty) {
            return const Center(
                child: Text('No bulletins.',
                    style: TextStyle(color: WardenColors.textDim)));
          }
          return ListView.builder(
            padding: const EdgeInsets.all(12),
            itemCount: list.length,
            itemBuilder: (context, i) => Card(
              color: WardenColors.surface,
              child: ListTile(
                title: Text(list[i].title,
                    style: const TextStyle(
                        color: WardenColors.text,
                        fontWeight: FontWeight.w600)),
                subtitle: Text(list[i].body,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: WardenColors.textDim)),
              ),
            ),
          );
        },
      ),
    );
  }
}

// ---- Doors ----

final _doorsProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  return ref.watch(apiProvider).bbsDoors();
});

class DoorsScreen extends ConsumerWidget {
  const DoorsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final d = ref.watch(_doorsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Doors')),
      body: d.when(
        loading: () => const Center(
            child: CircularProgressIndicator(color: WardenColors.cyan)),
        error: (e, _) => Center(
            child: Text('$e', style: const TextStyle(color: WardenColors.textDim))),
        data: (data) {
          final doors = (data['doors'] as List? ?? const [])
              .whereType<Map>()
              .map((m) => Door.fromJson(Map<String, dynamic>.from(m)))
              .toList();
          if (doors.isEmpty) {
            return const Center(
                child: Text('No doors installed.',
                    style: TextStyle(color: WardenColors.textDim)));
          }
          return ListView.builder(
            itemCount: doors.length,
            itemBuilder: (context, i) => ListTile(
              leading: const Icon(Icons.videogame_asset_outlined,
                  color: WardenColors.green),
              title: Text(doors[i].name,
                  style: const TextStyle(color: WardenColors.text)),
              subtitle: Text(doors[i].desc,
                  style: const TextStyle(
                      color: WardenColors.textDim, fontSize: 12)),
              onTap: () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => DoorScreen(name: doors[i].name)),
              ),
            ),
          );
        },
      ),
    );
  }
}

class DoorScreen extends ConsumerStatefulWidget {
  final String name;
  const DoorScreen({super.key, required this.name});

  @override
  ConsumerState<DoorScreen> createState() => _DoorScreenState();
}

class _DoorScreenState extends ConsumerState<DoorScreen> {
  String? _html;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final html = await ref.read(apiProvider).bbsDoorHtml(widget.name);
      setState(() => _html = html);
    } catch (e) {
      setState(() => _error = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.name)),
      body: _error != null
          ? Center(
              child: Text(_error!,
                  style: const TextStyle(color: WardenColors.textDim)))
          : _html == null
              ? const Center(
                  child: CircularProgressIndicator(color: WardenColors.cyan))
              : WebViewWidget(
                  controller: WebViewController()
                    ..setJavaScriptMode(JavaScriptMode.unrestricted)
                    ..loadHtmlString(_html!),
                ),
    );
  }
}

// ---- Users ----

final _usersProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  return ref.watch(apiProvider).bbsUsers();
});

class UsersScreen extends ConsumerWidget {
  const UsersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final u = ref.watch(_usersProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Users')),
      body: u.when(
        loading: () => const Center(
            child: CircularProgressIndicator(color: WardenColors.cyan)),
        error: (e, _) => Center(
            child: Text('$e', style: const TextStyle(color: WardenColors.textDim))),
        data: (d) {
          final users = (d['users'] as List? ?? const [])
              .whereType<Map>()
              .map((m) => BbsUser.fromJson(Map<String, dynamic>.from(m)))
              .toList();
          if (users.isEmpty) {
            return const Center(
                child: Text('No users.',
                    style: TextStyle(color: WardenColors.textDim)));
          }
          return ListView.builder(
            itemCount: users.length,
            itemBuilder: (context, i) => ListTile(
              leading: const Icon(Icons.person, color: WardenColors.cyan),
              title: Text(users[i].handle,
                  style: const TextStyle(color: WardenColors.text)),
              subtitle: Text(users[i].level,
                  style: const TextStyle(
                      color: WardenColors.textDim, fontSize: 12)),
            ),
          );
        },
      ),
    );
  }
}

// ---- Profile ----

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  final _name = TextEditingController();
  final _bio = TextEditingController();
  Profile? _profile;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final handle =
        ref.read(settingsProvider).valueOrNull?.handle ?? 'caller';
    try {
      final r = await ref.read(apiProvider).bbsProfile(handle);
      final p = Profile.fromJson(r);
      setState(() {
        _profile = p;
        _name.text = p.name;
        _bio.text = p.bio;
        _loading = false;
      });
    } catch (_) {
      setState(() => _loading = false);
    }
  }

  Future<void> _save() async {
    final handle =
        ref.read(settingsProvider).valueOrNull?.handle ?? 'caller';
    try {
      await ref.read(apiProvider).bbsProfileSave(handle, _name.text, _bio.text);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Profile saved')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Failed: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: WardenColors.cyan))
          : Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (_profile != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: Text(
                        '@${_profile!.handle} · ${_profile!.level.toUpperCase()}',
                        style: const TextStyle(
                            color: WardenColors.cyan, fontSize: 15),
                      ),
                    ),
                  TextField(
                    controller: _name,
                    style: const TextStyle(color: WardenColors.text),
                    decoration: const InputDecoration(
                      labelText: 'Display name',
                      labelStyle: TextStyle(color: WardenColors.textDim),
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _bio,
                    maxLines: 5,
                    style: const TextStyle(color: WardenColors.text),
                    decoration: const InputDecoration(
                      labelText: 'Bio',
                      labelStyle: TextStyle(color: WardenColors.textDim),
                    ),
                  ),
                  const SizedBox(height: 24),
                  FilledButton(
                    style: FilledButton.styleFrom(
                        backgroundColor: WardenColors.cyan,
                        foregroundColor: WardenColors.background),
                    onPressed: _save,
                    child: const Text('SAVE PROFILE'),
                  ),
                ],
              ),
            ),
    );
  }
}

// ---- Capabilities ----

class CapabilitiesScreen extends ConsumerStatefulWidget {
  const CapabilitiesScreen({super.key});

  @override
  ConsumerState<CapabilitiesScreen> createState() => _CapabilitiesScreenState();
}

class _CapabilitiesScreenState extends ConsumerState<CapabilitiesScreen> {
  final _q = TextEditingController();
  List<dynamic> _results = const [];
  bool _loading = false;

  Future<void> _search() async {
    setState(() => _loading = true);
    try {
      final r = await ref.read(apiProvider).bbsCapabilities(_q.text);
      setState(() {
        _results = (r['capabilities'] as List? ??
                r['items'] as List? ??
                const []);
        _loading = false;
      });
    } catch (_) {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Capabilities')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _q,
                    style: const TextStyle(color: WardenColors.text),
                    decoration: const InputDecoration(
                      hintText: 'Search capabilities…',
                      hintStyle: TextStyle(color: WardenColors.textDim),
                    ),
                    onSubmitted: (_) => _search(),
                  ),
                ),
                IconButton(
                  onPressed: _search,
                  icon: const Icon(Icons.search, color: WardenColors.cyan),
                ),
              ],
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(
                    child:
                        CircularProgressIndicator(color: WardenColors.cyan))
                : ListView(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    children: [
                      for (final item in _results)
                        Card(
                          color: WardenColors.surface,
                          child: ListTile(
                            title: Text(
                              item is Map ? (item['name']?.toString() ?? '') : '$item',
                              style: const TextStyle(color: WardenColors.text),
                            ),
                            subtitle: item is Map && item['description'] != null
                                ? Text(item['description'].toString(),
                                    style: const TextStyle(
                                        color: WardenColors.textDim,
                                        fontSize: 12))
                                : null,
                          ),
                        ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

// ---- Dial-in ----

class DialScreen extends ConsumerStatefulWidget {
  const DialScreen({super.key});

  @override
  ConsumerState<DialScreen> createState() => _DialScreenState();
}

class _DialScreenState extends ConsumerState<DialScreen> {
  final _host = TextEditingController();
  Map<String, dynamic>? _result;
  bool _loading = false;
  String? _error;

  Future<void> _dial() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final r = await ref.read(apiProvider).bbsDial(_host.text.trim());
      setState(() {
        _result = r;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = '$e';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = _result;
    return Scaffold(
      appBar: AppBar(title: const Text('Dial-in')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            controller: _host,
            style: const TextStyle(color: WardenColors.text),
            decoration: const InputDecoration(
              labelText: 'Friend hostname',
              hintText: 'e.g. forge-vps',
              labelStyle: TextStyle(color: WardenColors.textDim),
            ),
            onSubmitted: (_) => _dial(),
          ),
          const SizedBox(height: 12),
          FilledButton(
            style: FilledButton.styleFrom(
                backgroundColor: WardenColors.cyan,
                foregroundColor: WardenColors.background),
            onPressed: _loading ? null : _dial,
            child: Text(_loading ? 'DIALING…' : 'DIAL'),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 16),
              child: Text(_error!,
                  style: const TextStyle(color: WardenColors.red)),
            ),
          if (r != null) ...[
            const SizedBox(height: 20),
            Text(
              '${r['host']} — ${r['online'] == true ? 'online' : 'offline'}',
              style: TextStyle(
                  color: r['online'] == true
                      ? WardenColors.green
                      : WardenColors.red,
                  fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 12),
            for (final b in (r['boards'] as List? ?? const []))
              if (b is Map)
                ListTile(
                  dense: true,
                  leading: const Icon(Icons.dashboard,
                      color: WardenColors.cyan, size: 18),
                  title: Text('${b['name']}',
                      style: const TextStyle(color: WardenColors.text)),
                  subtitle: Text('${b['description'] ?? ''}',
                      style: const TextStyle(
                          color: WardenColors.textDim, fontSize: 12)),
                ),
          ],
        ],
      ),
    );
  }
}

// ---- Status ----

final _statusProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  return ref.watch(apiProvider).status();
});

class StatusScreen extends ConsumerWidget {
  const StatusScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(_statusProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Status')),
      body: s.when(
        loading: () => const Center(
            child: CircularProgressIndicator(color: WardenColors.cyan)),
        error: (e, _) => Center(
            child: Text('$e', style: const TextStyle(color: WardenColors.textDim))),
        data: (d) {
          final uptime = (d['uptime'] as num? ?? 0).toInt();
          final channels = (d['channels'] as List? ?? const []).join(', ');
          final groups = (d['groups'] as List? ?? const []);
          final model = (d['ollamaChatModel'] ?? d['localAssistant'] ?? '').toString();
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _row('Assistant', (d['assistant'] ?? '').toString()),
              _row('Uptime', _fmtUptime(uptime)),
              _row('Channels', channels.isEmpty ? 'none' : channels),
              _row('Groups', '${groups.length}'),
              _row('Active containers',
                  '${(d['activeContainers'] as num? ?? 0).toInt()}'),
              _row('Scheduled tasks',
                  '${(d['scheduledTasks'] as num? ?? 0).toInt()}'),
              if (model.isNotEmpty) _row('Model', model),
            ],
          );
        },
      ),
    );
  }

  Widget _row(String k, String v) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 130,
            child: Text(k,
                style: const TextStyle(color: WardenColors.textDim, fontSize: 13)),
          ),
          Expanded(
            child: Text(v, style: const TextStyle(color: WardenColors.text)),
          ),
        ],
      ),
    );
  }
}

String _fmtUptime(int seconds) {
  final d = seconds ~/ 86400;
  final h = (seconds % 86400) ~/ 3600;
  final m = (seconds % 3600) ~/ 60;
  if (d > 0) return '${d}d ${h}h ${m}m';
  if (h > 0) return '${h}h ${m}m';
  return '${m}m';
}
