import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/models.dart';
import '../../providers/providers.dart';
import '../../theme.dart';

final _bbsProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  return ref.watch(apiProvider).bbsState();
});

final _threadProvider =
    FutureProvider.family<Map<String, dynamic>, String>((ref, id) async {
  return ref.watch(apiProvider).bbsThread(id);
});

class BoardsScreen extends ConsumerWidget {
  const BoardsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bbs = ref.watch(_bbsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Boards')),
      body: bbs.when(
        loading: () => const _Center(loading: true),
        error: (e, _) => _Center(error: e.toString()),
        data: (d) {
          final boards = (d['boards'] as List? ?? const [])
              .whereType<Map>()
              .map((m) => Board.fromJson(Map<String, dynamic>.from(m)))
              .toList();
          final threads = (d['threads'] as List? ?? const [])
              .whereType<Map>()
              .map((m) => Thread.fromJson(Map<String, dynamic>.from(m)))
              .toList();

          return RefreshIndicator(
            onRefresh: () => ref.refresh(_bbsProvider.future),
            child: ListView(
              children: [
                for (final b in boards)
                  ListTile(
                    leading: const Icon(Icons.dashboard,
                        color: WardenColors.cyan),
                    title: Text(b.name,
                        style: const TextStyle(
                            fontWeight: FontWeight.w600,
                            color: WardenColors.text)),
                    subtitle: b.description.isEmpty
                        ? null
                        : Text(b.description,
                            style: const TextStyle(
                                color: WardenColors.textDim, fontSize: 12)),
                    trailing: Text(
                      '${threads.where((t) => t.board == b.name).length}',
                      style: const TextStyle(color: WardenColors.textDim),
                    ),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                          builder: (_) => ThreadsScreen(board: b.name)),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class ThreadsScreen extends ConsumerWidget {
  final String board;
  const ThreadsScreen({super.key, required this.board});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bbs = ref.watch(_bbsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(board)),
      floatingActionButton: FloatingActionButton(
        backgroundColor: WardenColors.cyan,
        foregroundColor: WardenColors.background,
        onPressed: () => _compose(context, ref, board: board),
        child: const Icon(Icons.add),
      ),
      body: bbs.when(
        loading: () => const _Center(loading: true),
        error: (e, _) => _Center(error: e.toString()),
        data: (d) {
          final threads = (d['threads'] as List? ?? const [])
              .whereType<Map>()
              .map((m) => Thread.fromJson(Map<String, dynamic>.from(m)))
              .where((t) => t.board == board)
              .toList();
          if (threads.isEmpty) {
            return const _Center(
                error: 'No threads yet.\nTap + to start one.');
          }
          return ListView.builder(
            itemCount: threads.length,
            itemBuilder: (context, i) {
              final t = threads[i];
              return ListTile(
                leading: const Icon(Icons.forum_outlined,
                    color: WardenColors.cyan),
                title: Text(t.title,
                    style: const TextStyle(color: WardenColors.text)),
                subtitle: Text(
                  '${t.posts} posts · ${t.host}',
                  style: const TextStyle(
                      color: WardenColors.textDim, fontSize: 12),
                ),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                      builder: (_) => ThreadScreen(threadId: t.id)),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class ThreadScreen extends ConsumerWidget {
  final String threadId;
  const ThreadScreen({super.key, required this.threadId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(_threadProvider(threadId));
    return Scaffold(
      appBar: AppBar(
        title: Text(data.valueOrNull?['thread'] is Map
            ? (data.valueOrNull!['thread']['title'] as String? ?? 'Thread')
            : 'Thread'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add, color: WardenColors.cyan),
            onPressed: () => _compose(context, ref, threadId: threadId),
          ),
        ],
      ),
      body: data.when(
        loading: () => const _Center(loading: true),
        error: (e, _) => _Center(error: e.toString()),
        data: (d) {
          final posts = (d['posts'] as List? ?? const [])
              .whereType<Map>()
              .map((m) => Post.fromJson(Map<String, dynamic>.from(m)))
              .toList();
          return ListView.builder(
            padding: const EdgeInsets.all(12),
            itemCount: posts.length,
            itemBuilder: (context, i) => _PostCard(post: posts[i]),
          );
        },
      ),
    );
  }
}

class _PostCard extends StatelessWidget {
  final Post post;
  const _PostCard({required this.post});

  @override
  Widget build(BuildContext context) {
    return Card(
      color: WardenColors.surface,
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    post.author.isEmpty ? 'anonymous' : post.author,
                    style: const TextStyle(
                        color: WardenColors.cyan,
                        fontSize: 12,
                        fontWeight: FontWeight.w600),
                  ),
                ),
                Text(
                  post.created == null ? '' : _fmt(post.created!),
                  style: const TextStyle(
                      color: WardenColors.textDim, fontSize: 11),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(post.body,
                style: const TextStyle(
                    color: WardenColors.text, fontSize: 14, height: 1.4)),
          ],
        ),
      ),
    );
  }
}

Future<void> _compose(BuildContext context, WidgetRef ref,
    {String? board, String? threadId}) async {
  final titleCtrl = TextEditingController();
  final bodyCtrl = TextEditingController();
  final result = await showModalBottomSheet<Map<String, String>>(
    context: context,
    isScrollControlled: true,
    backgroundColor: WardenColors.surface,
    builder: (context) => Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (threadId == null)
            TextField(
              controller: titleCtrl,
              style: const TextStyle(color: WardenColors.text),
              decoration: const InputDecoration(
                labelText: 'Title',
                labelStyle: TextStyle(color: WardenColors.textDim),
              ),
            ),
          const SizedBox(height: 12),
          TextField(
            controller: bodyCtrl,
            maxLines: 5,
            autofocus: true,
            style: const TextStyle(color: WardenColors.text),
            decoration: const InputDecoration(
              labelText: 'Message',
              labelStyle: TextStyle(color: WardenColors.textDim),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton(
            style: FilledButton.styleFrom(
                backgroundColor: WardenColors.cyan,
                foregroundColor: WardenColors.background),
            onPressed: () => Navigator.of(context).pop({
              'title': titleCtrl.text.trim(),
              'body': bodyCtrl.text,
            }),
            child: const Text('POST'),
          ),
        ],
      ),
    ),
  );

  if (result == null || (result['body'] ?? '').trim().isEmpty) return;

  final b = board ?? '';
  try {
    await ref.read(apiProvider).bbsPost({
      if (b.isNotEmpty) 'board': b,
      if (threadId != null) 'thread_id': threadId,
      if ((result['title'] ?? '').isNotEmpty) 'title': result['title'],
      'body': result['body'],
    });
    ref.invalidate(_bbsProvider);
    if (threadId != null) ref.invalidate(_threadProvider(threadId));
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Post failed: $e')));
    }
  }
}

class _Center extends StatelessWidget {
  final bool loading;
  final String? error;
  const _Center({this.loading = false, this.error});

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Center(
          child: CircularProgressIndicator(color: WardenColors.cyan));
    }
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(error ?? 'Something went wrong',
            textAlign: TextAlign.center,
            style: const TextStyle(color: WardenColors.textDim)),
      ),
    );
  }
}

String _fmt(DateTime t) {
  final h = t.hour.toString().padLeft(2, '0');
  final m = t.minute.toString().padLeft(2, '0');
  return '${t.month}/${t.day} $h:$m';
}
