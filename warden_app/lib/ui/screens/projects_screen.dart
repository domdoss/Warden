import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/models.dart';
import '../../providers/providers.dart';
import '../../theme.dart';
import 'project_detail_screen.dart';

final _projectsProvider =
    FutureProvider<List<Project>>((ref) => ref.watch(apiProvider).projects());

class ProjectsScreen extends ConsumerWidget {
  const ProjectsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = ref.watch(_projectsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Projects')),
      floatingActionButton: FloatingActionButton(
        backgroundColor: WardenColors.crimson,
        foregroundColor: WardenColors.background,
        onPressed: () => _add(context, ref),
        child: const Icon(Icons.add),
      ),
      body: p.when(
        loading: () => const Center(
            child: CircularProgressIndicator(color: WardenColors.crimson)),
        error: (e, _) => Center(
            child: Text('$e', style: const TextStyle(color: WardenColors.textDim))),
        data: (list) => list.isEmpty
            ? const Center(
                child: Text('No projects.',
                    style: TextStyle(color: WardenColors.textDim)))
            : RefreshIndicator(
                onRefresh: () => ref.refresh(_projectsProvider.future),
                child: ListView.builder(
                  padding: const EdgeInsets.all(12),
                  itemCount: list.length,
                  itemBuilder: (context, i) {
                    final pr = list[i];
                    return Card(
                      color: WardenColors.surface,
                      child: ListTile(
                        leading: const Icon(Icons.folder_copy_outlined,
                            color: WardenColors.crimson),
                        title: Text(pr.name,
                            style: const TextStyle(color: WardenColors.text)),
                        subtitle: Text(
                          [pr.status, pr.dueDate, pr.description]
                              .where((s) => s.isNotEmpty)
                              .join(' · '),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              color: WardenColors.textDim, fontSize: 12),
                        ),
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute(
                              builder: (_) =>
                                  ProjectDetailScreen(projectId: pr.id)),
                        ),
                      ),
                    );
                  },
                ),
              ),
      ),
    );
  }
}

Future<void> _add(BuildContext context, WidgetRef ref) async {
  final name = TextEditingController();
  final desc = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      backgroundColor: WardenColors.surface,
      title: const Text('New project',
          style: TextStyle(color: WardenColors.text)),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: name,
            autofocus: true,
            style: const TextStyle(color: WardenColors.text),
            decoration: const InputDecoration(
              labelText: 'Name',
              labelStyle: TextStyle(color: WardenColors.textDim),
            ),
          ),
          TextField(
            controller: desc,
            style: const TextStyle(color: WardenColors.text),
            decoration: const InputDecoration(
              labelText: 'Description',
              labelStyle: TextStyle(color: WardenColors.textDim),
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Cancel',
              style: TextStyle(color: WardenColors.textDim)),
        ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: const Text('Create',
              style: TextStyle(color: WardenColors.crimson)),
        ),
      ],
    ),
  );
  if (ok == true && name.text.trim().isNotEmpty) {
    try {
      await ref.read(apiProvider).addProject({
        'name': name.text.trim(),
        if (desc.text.trim().isNotEmpty) 'description': desc.text.trim(),
      });
      ref.invalidate(_projectsProvider);
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Failed: $e')));
      }
    }
  }
}
