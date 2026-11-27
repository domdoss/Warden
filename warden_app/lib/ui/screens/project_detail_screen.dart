import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/providers.dart';
import '../../theme.dart';

final _detailProvider = FutureProvider.family<Map<String, dynamic>, String>(
    (ref, id) => ref.watch(apiProvider).projectDetail(id));

/// A project, expanded: its detail, tasks, and deliverables.
class ProjectDetailScreen extends ConsumerWidget {
  final String projectId;
  const ProjectDetailScreen({super.key, required this.projectId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(_detailProvider(projectId));
    return Scaffold(
      appBar: AppBar(
        title: Text(detail.valueOrNull?['name']?.toString() ?? 'Project'),
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_outline, color: WardenColors.red),
            onPressed: () => _delete(context, ref),
          ),
        ],
      ),
      body: detail.when(
        loading: () => const Center(
            child: CircularProgressIndicator(color: WardenColors.crimson)),
        error: (e, _) => Center(
            child: Text('$e', style: const TextStyle(color: WardenColors.textDim))),
        data: (d) {
          final name = (d['name'] ?? '').toString();
          final desc = (d['description'] ?? '').toString();
          final status = (d['status'] ?? '').toString();
          final due = (d['due_date'] ?? '').toString();
          final tasks = (d['tasks'] as List? ?? const []);
          final deliverables = (d['deliverables'] as List? ?? const []);

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(name,
                  style: const TextStyle(
                      color: WardenColors.text,
                      fontSize: 22,
                      fontWeight: FontWeight.w700)),
              if (status.isNotEmpty || due.isNotEmpty) ...[
                const SizedBox(height: 6),
                Text([status, due].where((s) => s.isNotEmpty).join(' · '),
                    style: const TextStyle(
                        color: WardenColors.textDim, fontSize: 13)),
              ],
              if (desc.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(desc,
                    style: const TextStyle(
                        color: WardenColors.text, fontSize: 14, height: 1.4)),
              ],
              const SizedBox(height: 20),
              _Header('TASKS · ${tasks.length}'),
              if (tasks.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(12),
                  child: Text('No tasks yet.',
                      style: TextStyle(color: WardenColors.textDim)),
                )
              else
                for (final t in tasks) _taskTile(t),
              if (deliverables.isNotEmpty) ...[
                const SizedBox(height: 20),
                _Header('DELIVERABLES · ${deliverables.length}'),
                for (final dl in deliverables) _deliverableTile(dl),
              ],
            ],
          );
        },
      ),
    );
  }

  Future<void> _delete(BuildContext context, WidgetRef ref) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: WardenColors.surface,
        title:
            const Text('Delete project', style: TextStyle(color: WardenColors.text)),
        content: const Text('Delete this project?',
            style: TextStyle(color: WardenColors.text)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel',
                style: TextStyle(color: WardenColors.textDim)),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child:
                const Text('Delete', style: TextStyle(color: WardenColors.red)),
          ),
        ],
      ),
    );
    if (ok == true) {
      await ref.read(apiProvider).deleteProject(projectId);
      if (context.mounted) Navigator.of(context).pop();
    }
  }

  Widget _taskTile(dynamic t) {
    final m = t is Map ? t : <dynamic, dynamic>{};
    final title = (m['title'] ?? m['name'] ?? m['description'] ?? '').toString();
    final status = (m['status'] ?? '').toString();
    return ListTile(
      dense: true,
      leading: const Icon(Icons.task_alt, color: WardenColors.cyan, size: 18),
      title: Text(title.isEmpty ? '(untitled)' : title,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(color: WardenColors.text, fontSize: 13)),
      subtitle: status.isEmpty
          ? null
          : Text(status,
              style: const TextStyle(color: WardenColors.textDim, fontSize: 11)),
    );
  }

  Widget _deliverableTile(dynamic dl) {
    final m = dl is Map ? dl : <dynamic, dynamic>{};
    final title = (m['title'] ?? m['name'] ?? m['description'] ?? '').toString();
    final status = (m['status'] ?? '').toString();
    return ListTile(
      dense: true,
      leading: const Icon(Icons.check_box_outline_blank,
          color: WardenColors.crimson, size: 18),
      title: Text(title,
          style: const TextStyle(color: WardenColors.text, fontSize: 13)),
      subtitle: status.isEmpty
          ? null
          : Text(status,
              style: const TextStyle(color: WardenColors.textDim, fontSize: 11)),
    );
  }
}

class _Header extends StatelessWidget {
  final String text;
  const _Header(this.text);
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(text,
          style: const TextStyle(
              color: WardenColors.textDim,
              fontSize: 11,
              fontWeight: FontWeight.bold,
              letterSpacing: 2)),
    );
  }
}
