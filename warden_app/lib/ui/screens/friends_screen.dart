import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/models.dart';
import '../../providers/providers.dart';
import '../../theme.dart';

final _friendsProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  return ref.watch(apiProvider).friends();
});

/// Friends — the mesh. Add, accept, ping, message, remove, block.
class FriendsScreen extends ConsumerWidget {
  const FriendsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final f = ref.watch(_friendsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Friends')),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: WardenColors.crimson,
        foregroundColor: WardenColors.background,
        onPressed: () => _addFriend(context, ref),
        icon: const Icon(Icons.person_add_alt_1),
        label: const Text('Add friend'),
      ),
      body: f.when(
        loading: () => const Center(
            child: CircularProgressIndicator(color: WardenColors.crimson)),
        error: (e, _) => Center(
            child: Text('$e', style: const TextStyle(color: WardenColors.textDim))),
        data: (d) {
          final tailscale = d['tailscale'];
          final state =
              tailscale is Map ? (tailscale['state'] ?? '').toString() : '';
          final friends = (d['friends'] as List? ?? const [])
              .whereType<Map>()
              .map((m) => Friend.fromJson(Map<String, dynamic>.from(m)))
              .toList();
          final requests = (d['requests'] as List? ?? const []);
          final blocks = (d['blocks'] as List? ?? const []);
          final messages = (d['messages'] as List? ?? const []);

          return RefreshIndicator(
            onRefresh: () => ref.refresh(_friendsProvider.future),
            child: ListView(
              padding: const EdgeInsets.all(12),
              children: [
                _StatusCard(state: state),
                const SizedBox(height: 12),
                _Header('FRIENDS · ${friends.length}'),
                if (friends.isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: Text('No friends yet. Tap "Add friend" to invite one.',
                        style: TextStyle(color: WardenColors.textDim)),
                  ),
                for (final fr in friends)
                  ListTile(
                    leading: Icon(
                      fr.online ? Icons.circle : Icons.radio_button_unchecked,
                      color: fr.online
                          ? WardenColors.green
                          : WardenColors.textDim,
                      size: 14,
                    ),
                    title: Text(fr.hostname,
                        style: const TextStyle(color: WardenColors.text)),
                    subtitle: fr.specialists.isEmpty
                        ? null
                        : Text(fr.specialists.join(', '),
                            style: const TextStyle(
                                color: WardenColors.textDim, fontSize: 12)),
                    trailing: PopupMenuButton<String>(
                      icon: const Icon(Icons.more_vert,
                          color: WardenColors.textDim),
                      onSelected: (v) =>
                          _friendAction(context, ref, v, fr),
                      itemBuilder: (_) => const [
                        PopupMenuItem(value: 'message', child: Text('Message')),
                        PopupMenuItem(value: 'ping', child: Text('Ping')),
                        PopupMenuItem(value: 'remove', child: Text('Remove')),
                        PopupMenuItem(value: 'block', child: Text('Block')),
                      ],
                    ),
                  ),
                if (requests.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  _Header('REQUESTS · ${requests.length}'),
                  for (final r in requests)
                    _requestTile(context, ref, r),
                ],
                if (blocks.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  _Header('BLOCKED · ${blocks.length}'),
                  for (final b in blocks)
                    ListTile(
                      leading: const Icon(Icons.block,
                          color: WardenColors.red),
                      title: Text(
                        b is Map
                            ? '${b['hostname'] ?? '?'}'
                            : '$b',
                        style: const TextStyle(color: WardenColors.text),
                      ),
                      trailing: TextButton(
                        onPressed: () => _unblock(context, ref, b),
                        child: const Text('Unblock',
                            style: TextStyle(color: WardenColors.crimson)),
                      ),
                    ),
                ],
                const SizedBox(height: 12),
                _Header('MESSAGES · ${messages.length}'),
                for (final m in messages)
                  ListTile(
                    dense: true,
                    leading: const Icon(Icons.chat_bubble_outline,
                        color: WardenColors.crimson, size: 18),
                    title: Text(
                      m is Map
                          ? '${m['from_hostname'] ?? m['from'] ?? ''}: ${m['body'] ?? m['message'] ?? ''}'
                          : '$m',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          color: WardenColors.text, fontSize: 13),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _requestTile(BuildContext context, WidgetRef ref, dynamic r) {
    final host = r is Map ? (r['from_hostname'] ?? r['hostname'] ?? '').toString() : '$r';
    return ListTile(
      leading: const Icon(Icons.person_add_alt_1, color: WardenColors.amber),
      title: Text(host, style: const TextStyle(color: WardenColors.text)),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            icon: const Icon(Icons.check, color: WardenColors.green),
            onPressed: () => _accept(ref, host),
          ),
          IconButton(
            icon: const Icon(Icons.close, color: WardenColors.red),
            onPressed: () => _deny(ref, host),
          ),
        ],
      ),
    );
  }

  Future<void> _addFriend(BuildContext context, WidgetRef ref) async {
    final ctrl = TextEditingController();
    final host = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: WardenColors.surface,
        title:
            const Text('Add friend', style: TextStyle(color: WardenColors.text)),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          style: const TextStyle(color: WardenColors.text),
          decoration: const InputDecoration(
            hintText: 'friend hostname',
            hintStyle: TextStyle(color: WardenColors.textDim),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel',
                style: TextStyle(color: WardenColors.textDim)),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(ctrl.text.trim()),
            child: const Text('Invite',
                style: TextStyle(color: WardenColors.crimson)),
          ),
        ],
      ),
    );
    if (host == null || host.isEmpty) return;
    try {
      final r = await ref.read(apiProvider).friendsInvite(host);
      ref.invalidate(_friendsProvider);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text(r['ok'] == true
                  ? 'Invite sent to $host'
                  : 'Invite: ${r['error'] ?? r['ok'] ?? 'sent'}')),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Invite failed: $e')));
      }
    }
  }

  Future<void> _friendAction(BuildContext context, WidgetRef ref,
      String action, Friend fr) async {
    switch (action) {
      case 'message':
        await _message(context, ref, fr);
      case 'ping':
        final r = await ref.read(apiProvider).friendsPing(fr.hostname);
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
              content: Text('Ping: ${r['ok'] == true ? 'pong' : (r['error'] ?? 'no response')}')));
        }
      case 'remove':
        await _remove(context, ref, fr);
      case 'block':
        await _block(context, ref, fr);
    }
  }

  Future<void> _message(BuildContext context, WidgetRef ref, Friend fr) async {
    final ctrl = TextEditingController();
    final msg = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: WardenColors.surface,
        title: Text('Message ${fr.hostname}',
            style: const TextStyle(color: WardenColors.text, fontSize: 16)),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          style: const TextStyle(color: WardenColors.text),
          decoration: const InputDecoration(
            hintText: 'Message…',
            hintStyle: TextStyle(color: WardenColors.textDim),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel',
                style: TextStyle(color: WardenColors.textDim)),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(ctrl.text),
            child: const Text('Send',
                style: TextStyle(color: WardenColors.crimson)),
          ),
        ],
      ),
    );
    if (msg == null || msg.trim().isEmpty) return;
    await ref.read(apiProvider).dm(fr.hostname, msg.trim());
    if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Sent')));
    }
  }

  Future<void> _remove(BuildContext context, WidgetRef ref, Friend fr) async {
    final ok = await _confirm(context, 'Remove ${fr.hostname}?');
    if (ok == true) {
      await ref.read(apiProvider).friendsRemove(fr.hostname);
      ref.invalidate(_friendsProvider);
    }
  }

  Future<void> _block(BuildContext context, WidgetRef ref, Friend fr) async {
    final ok = await _confirm(context, 'Block ${fr.hostname}?');
    if (ok == true) {
      await ref.read(apiProvider).friendsBlock(fr.hostname, 'blocked');
      ref.invalidate(_friendsProvider);
    }
  }

  Future<void> _accept(WidgetRef ref, String host) async {
    await ref.read(apiProvider).friendsAccept(host);
    ref.invalidate(_friendsProvider);
  }

  Future<void> _deny(WidgetRef ref, String host) async {
    await ref.read(apiProvider).friendsDeny(host);
    ref.invalidate(_friendsProvider);
  }

  Future<void> _unblock(BuildContext context, WidgetRef ref, dynamic b) async {
    final host = b is Map ? (b['hostname'] ?? '').toString() : '$b';
    await ref.read(apiProvider).friendsUnblock(host);
    ref.invalidate(_friendsProvider);
  }

  Future<bool?> _confirm(BuildContext context, String message) {
    return showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: WardenColors.surface,
        title: const Text('Confirm', style: TextStyle(color: WardenColors.text)),
        content:
            Text(message, style: const TextStyle(color: WardenColors.text)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel',
                style: TextStyle(color: WardenColors.textDim)),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Yes',
                style: TextStyle(color: WardenColors.red)),
          ),
        ],
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  final String state;
  const _StatusCard({required this.state});

  @override
  Widget build(BuildContext context) {
    final online = state.toLowerCase() == 'running';
    final color = online ? WardenColors.green : WardenColors.amber;
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
          Text('Tailnet: ${state.isEmpty ? 'unknown' : state}',
              style: const TextStyle(color: WardenColors.text, fontSize: 13)),
        ],
      ),
    );
  }
}

class _Header extends StatelessWidget {
  final String text;
  const _Header(this.text);
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 8, 4, 6),
      child: Text(text,
          style: const TextStyle(
              color: WardenColors.textDim,
              fontSize: 11,
              fontWeight: FontWeight.bold,
              letterSpacing: 2)),
    );
  }
}
