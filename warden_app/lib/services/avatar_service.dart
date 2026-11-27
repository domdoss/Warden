import 'dart:io';

import 'package:file_selector/file_selector.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Stores the sender's bubble avatar. The user picks an image once; it is
/// copied into the app's support dir (so it survives cache clears) and the
/// path is remembered in prefs. Every right-side (user) bubble shows it.
class AvatarService {
  static const _kPath = 'user_avatar_path';

  Future<String?> getPath() async {
    final prefs = await SharedPreferences.getInstance();
    final p = prefs.getString(_kPath);
    if (p != null && p.isNotEmpty && File(p).existsSync()) return p;
    return null;
  }

  Future<String?> pickAndSave() async {
    const group = XTypeGroup(
      label: 'Images',
      extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'],
    );
    final picked = await openFile(acceptedTypeGroups: [group]);
    if (picked == null || picked.path.isEmpty) return null;
    final dir = await getApplicationSupportDirectory();
    final dot = picked.path.lastIndexOf('.');
    final ext = dot >= 0 ? picked.path.substring(dot + 1).toLowerCase() : 'png';
    final dest = File('${dir.path}/user_avatar.$ext');
    await File(picked.path).copy(dest.path);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kPath, dest.path);
    return dest.path;
  }

  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kPath);
  }
}
