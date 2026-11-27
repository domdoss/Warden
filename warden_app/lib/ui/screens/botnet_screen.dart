import 'package:flutter/material.dart';

import '../../theme.dart';
import 'boards_screen.dart';
import 'files_screen.dart';
import 'mail_screen.dart';
import 'more_screen.dart';
import 'settings_screen.dart';

/// The console — the BBS/mesh surface, deliberately tucked one tap deep.
class BotNetScreen extends StatelessWidget {
  const BotNetScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final tiles = <(String, IconData, Widget)>[
      ('Boards', Icons.dashboard_outlined, const BoardsScreen()),
      ('Files', Icons.folder_outlined, const FilesScreen()),
      ('Mail', Icons.mail_outline, const MailScreen()),
      ('Bulletins', Icons.campaign_outlined, const BulletinsScreen()),
      ('Doors', Icons.extension_outlined, const DoorsScreen()),
      ('Users', Icons.people_outline, const UsersScreen()),
      ('Profile', Icons.person_outline, const ProfileScreen()),
      ('Capabilities', Icons.auto_awesome_outlined, const CapabilitiesScreen()),
      ('Dial-in', Icons.dialpad_outlined, const DialScreen()),
      ('Status', Icons.monitor_heart_outlined, const StatusScreen()),
      ('Settings', Icons.settings_outlined, const SettingsScreen()),
    ];

    return Scaffold(
      appBar: AppBar(title: const Text('BotNet')),
      body: GridView.builder(
        padding: const EdgeInsets.all(16),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          mainAxisSpacing: 12,
          crossAxisSpacing: 12,
          childAspectRatio: 1.35,
        ),
        itemCount: tiles.length,
        itemBuilder: (context, i) {
          final (label, icon, page) = tiles[i];
          return _Tile(
            icon: icon,
            label: label,
            onTap: () => Navigator.of(context)
                .push(MaterialPageRoute(builder: (_) => page)),
          );
        },
      ),
    );
  }
}

class _Tile extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _Tile({required this.icon, required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        decoration: BoxDecoration(
          color: WardenColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: WardenColors.border),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: WardenColors.crimson, size: 28),
            const SizedBox(height: 8),
            Text(label,
                style: const TextStyle(
                    color: WardenColors.text, fontSize: 13)),
          ],
        ),
      ),
    );
  }
}
