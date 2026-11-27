import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/providers.dart';
import '../services/tailscale_service.dart';
import '../theme.dart';
import 'mascot.dart';
import 'screens/agenda_screen.dart';
import 'screens/botnet_screen.dart';
import 'screens/chat_screen.dart';
import 'screens/email_screen.dart';
import 'screens/friends_screen.dart';
import 'screens/heartbeat_screen.dart';
import 'screens/home_screen.dart';
import 'screens/image_gen_screen.dart';
import 'screens/projects_screen.dart';
import 'screens/settings_screen.dart';

class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});

  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  final _scaffoldKey = GlobalKey<ScaffoldState>();
  int _index = 0;

  static const _pages = <Widget>[
    HomeScreen(),
    ChatScreen(),
    AgendaScreen(),
  ];

  void _openPage(Widget page) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: _scaffoldKey,
      drawer: _Drawer(onSelect: _onDrawerSelect),
      body: SizedBox.expand(
        child: Stack(
          children: [
            Positioned.fill(
                child: IndexedStack(index: _index, children: _pages)),
            if (_index == 0)
              _TopStrip(
                onMenu: () => _scaffoldKey.currentState?.openDrawer(),
              ),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.blur_circular),
            selectedIcon: Icon(Icons.blur_circular),
            label: 'Home',
          ),
          NavigationDestination(
            icon: Icon(Icons.forum_outlined),
            selectedIcon: Icon(Icons.forum),
            label: 'Chat',
          ),
          NavigationDestination(
            icon: Icon(Icons.event_note_outlined),
            selectedIcon: Icon(Icons.event_note),
            label: 'Agenda',
          ),
        ],
      ),
    );
  }

  void _onDrawerSelect(String dest) {
    Navigator.of(context).pop(); // close drawer
    switch (dest) {
      case 'home':
        setState(() => _index = 0);
      case 'chat':
        setState(() => _index = 1);
      case 'agenda':
        setState(() => _index = 2);
      case 'friends':
        _openPage(const FriendsScreen());
      case 'projects':
        _openPage(const ProjectsScreen());
      case 'email':
        _openPage(const EmailScreen());
      case 'botnet':
        _openPage(const BotNetScreen());
      case 'imagegen':
        _openPage(const ImageGenScreen());
      case 'heartbeat':
        _openPage(const HeartbeatScreen());
      case 'settings':
        _openPage(const SettingsScreen());
    }
  }
}

class _Drawer extends ConsumerWidget {
  final void Function(String) onSelect;
  const _Drawer({required this.onSelect});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final st =
        ref.watch(tailscaleStateProvider).valueOrNull ?? TailscaleState.stopped;
    final connected = st == TailscaleState.connected;
    final color = connected ? WardenColors.green : WardenColors.amber;

    return Drawer(
      child: SafeArea(
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            DrawerHeader(
              decoration: const BoxDecoration(color: WardenColors.surfaceAlt),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  Row(
                    children: [
                      const WardenMascot(pose: MascotPose.idle, size: 40),
                      const SizedBox(width: 12),
                      const Text('WARDEN',
                          style: TextStyle(
                              fontSize: 22,
                              fontWeight: FontWeight.w700,
                              color: WardenColors.text,
                              letterSpacing: 3)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Container(
                        width: 8,
                        height: 8,
                        decoration: BoxDecoration(
                            color: color, shape: BoxShape.circle),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        connected ? 'ONLINE' : 'CONNECTING…',
                        style: TextStyle(
                            color: color,
                            fontSize: 11,
                            letterSpacing: 2),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            _item(Icons.blur_circular, 'Home', () => onSelect('home')),
            _item(Icons.forum_outlined, 'Chat', () => onSelect('chat')),
            _item(Icons.event_note_outlined, 'Agenda', () => onSelect('agenda')),
            const Divider(color: WardenColors.border),
            _item(Icons.shield_outlined, 'Friends', () => onSelect('friends')),
            _item(Icons.flag_outlined, 'Projects', () => onSelect('projects')),
            _item(Icons.drafts_outlined, 'Email', () => onSelect('email')),
            _item(Icons.monitor_heart_outlined, 'Heartbeat', () => onSelect('heartbeat')),
            const Divider(color: WardenColors.border),
            _item(Icons.hub_outlined, 'BotNet', () => onSelect('botnet')),
            _item(Icons.auto_awesome, 'Image Gen', () => onSelect('imagegen')),
            _item(Icons.settings_outlined, 'Settings', () => onSelect('settings')),
          ],
        ),
      ),
    );
  }

  Widget _item(IconData icon, String label, VoidCallback onTap) {
    return ListTile(
      leading: Icon(icon, color: WardenColors.crimson),
      title: Text(label, style: const TextStyle(color: WardenColors.text)),
      onTap: onTap,
    );
  }
}

class _TopStrip extends ConsumerStatefulWidget {
  final VoidCallback onMenu;
  const _TopStrip({required this.onMenu});

  @override
  ConsumerState<_TopStrip> createState() => _TopStripState();
}

class _TopStripState extends ConsumerState<_TopStrip> {
  late final Timer _timer;
  DateTime _now = DateTime.now();

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _now = DateTime.now());
    });
  }

  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final st =
        ref.watch(tailscaleStateProvider).valueOrNull ?? TailscaleState.stopped;
    final connected = st == TailscaleState.connected;
    final color = connected ? WardenColors.green : WardenColors.amber;
    final hh = _now.hour.toString().padLeft(2, '0');
    final mm = _now.minute.toString().padLeft(2, '0');

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: Row(
          children: [
            IconButton(
              icon: const Icon(Icons.menu_rounded, color: WardenColors.text),
              onPressed: widget.onMenu,
            ),
            const Text('WARDEN',
                style: TextStyle(
                    color: WardenColors.text,
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 3)),
            const Spacer(),
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            ),
            const SizedBox(width: 8),
            Text('$hh:$mm',
                style: const TextStyle(
                    color: WardenColors.textDim,
                    fontSize: 14,
                    fontFamily: 'monospace')),
          ],
        ),
      ),
    );
  }
}
