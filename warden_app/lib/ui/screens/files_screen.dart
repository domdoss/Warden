import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/models.dart';
import '../../providers/providers.dart';
import '../../theme.dart';

final _sharedFilesProvider =
    FutureProvider<List<BbsFile>>((ref) => ref.watch(apiProvider).bbsFiles());

/// The shared file area — files live on the Warden host and are shared across
/// the mesh. Upload, read, and delete.
class FilesScreen extends ConsumerWidget {
  const FilesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final files = ref.watch(_sharedFilesProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Files')),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: WardenColors.crimson,
        foregroundColor: WardenColors.background,
        onPressed: () => _upload(context, ref),
        icon: const Icon(Icons.upload_file),
        label: const Text('Upload'),
      ),
      body: files.when(
        loading: () => const Center(
            child: CircularProgressIndicator(color: WardenColors.crimson)),
        error: (e, _) => Center(
            child: Text('$e', style: const TextStyle(color: WardenColors.textDim))),
        data: (list) => list.isEmpty
            ? const Center(
                child: Text('Shared folder is empty.\nTap Upload to add a file.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: WardenColors.textDim)))
            : RefreshIndicator(
                onRefresh: () => ref.refresh(_sharedFilesProvider.future),
                child: ListView.builder(
                  itemCount: list.length,
                  itemBuilder: (context, i) {
                    final f = list[i];
                    return ListTile(
                      leading: const Icon(Icons.insert_drive_file_outlined,
                          color: WardenColors.cyan),
                      title: Text(f.name,
                          style: const TextStyle(color: WardenColors.text)),
                      subtitle: Text(
                        _fmtSize(f.size),
                        style: const TextStyle(
                            color: WardenColors.textDim, fontSize: 12),
                      ),
                      trailing: PopupMenuButton<String>(
                        icon: const Icon(Icons.more_vert,
                            color: WardenColors.textDim),
                        onSelected: (v) {
                          if (v == 'delete') _delete(context, ref, f.name);
                        },
                        itemBuilder: (_) => const [
                          PopupMenuItem(value: 'delete', child: Text('Delete')),
                        ],
                      ),
                      onTap: () => _open(context, ref, f.name),
                    );
                  },
                ),
              ),
      ),
    );
  }

  Future<void> _upload(BuildContext context, WidgetRef ref) async {
    final XFile? picked = await openFile();
    if (picked == null) return;
    try {
      final bytes = await picked.readAsBytes();
      await ref.read(apiProvider).bbsFileUpload(picked.name, bytes);
      ref.invalidate(_sharedFilesProvider);
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Uploaded ${picked.name}')));
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Upload failed: $e')));
      }
    }
  }

  Future<void> _delete(BuildContext context, WidgetRef ref, String name) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: WardenColors.surface,
        title: const Text('Delete file',
            style: TextStyle(color: WardenColors.text)),
        content: Text('Delete "$name"?',
            style: const TextStyle(color: WardenColors.text)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel',
                style: TextStyle(color: WardenColors.textDim)),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete',
                style: TextStyle(color: WardenColors.red)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(apiProvider).bbsFileDelete(name);
      ref.invalidate(_sharedFilesProvider);
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Delete failed: $e')));
      }
    }
  }

  Future<void> _open(BuildContext context, WidgetRef ref, String name) async {
    try {
      final r = await ref.read(apiProvider).bbsFileRead(name);
      final content = (r['content'] ?? '').toString();
      if (!context.mounted) return;
      showDialog(
        context: context,
        builder: (_) => AlertDialog(
          backgroundColor: WardenColors.surface,
          title: Text(name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: WardenColors.text, fontSize: 16)),
          content: SizedBox(
            width: double.maxFinite,
            child: SingleChildScrollView(
              child: SelectableText(
                content.isEmpty ? '(empty file)' : content,
                style: const TextStyle(
                  color: WardenColors.text,
                  fontFamily: 'monospace',
                  fontSize: 13,
                ),
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Close',
                  style: TextStyle(color: WardenColors.crimson)),
            ),
          ],
        ),
      );
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Read failed: $e')));
      }
    }
  }
}

String _fmtSize(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
  if (bytes < 1024 * 1024 * 1024) {
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
  return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(1)} GB';
}
