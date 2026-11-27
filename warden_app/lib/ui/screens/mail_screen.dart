import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/models.dart';
import '../../providers/providers.dart';
import '../../theme.dart';

final _mailProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  return ref.watch(apiProvider).bbsMail();
});

class MailScreen extends ConsumerWidget {
  const MailScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mail = ref.watch(_mailProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Mail')),
      floatingActionButton: FloatingActionButton(
        backgroundColor: WardenColors.cyan,
        foregroundColor: WardenColors.background,
        onPressed: () => _sendDm(context, ref),
        child: const Icon(Icons.send),
      ),
      body: mail.when(
        loading: () => const Center(
            child: CircularProgressIndicator(color: WardenColors.cyan)),
        error: (e, _) => Center(
            child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text('$e',
              textAlign: TextAlign.center,
              style: const TextStyle(color: WardenColors.textDim)),
        )),
        data: (d) {
          final messages = (d['messages'] as List? ?? const [])
              .whereType<Map>()
              .map((m) => MailMessage.fromJson(Map<String, dynamic>.from(m)))
              .toList();
          final mentions = (d['mentions'] as List? ?? const [])
              .whereType<Map>()
              .map((m) => Mention.fromJson(Map<String, dynamic>.from(m)))
              .toList();
          final unread = (d['unread'] as num? ?? 0).toInt();

          return RefreshIndicator(
            onRefresh: () => ref.refresh(_mailProvider.future),
            child: ListView(
              children: [
                if (mentions.isNotEmpty)
                  _SectionHeader('Mentions · $unread unread'),
                for (final m in mentions)
                  ListTile(
                    leading: const Icon(Icons.alternate_email,
                        color: WardenColors.amber),
                    title: Text(m.body,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: WardenColors.text)),
                    subtitle: Text(
                        m.at == null ? '' : _fmt(m.at!),
                        style: const TextStyle(
                            color: WardenColors.textDim, fontSize: 11)),
                    onTap: () => _showMention(context, m),
                  ),
                if (mentions.isNotEmpty && messages.isNotEmpty) const Divider(),
                if (messages.isNotEmpty) const _SectionHeader('Messages'),
                for (final m in messages)
                  ListTile(
                    leading: const Icon(Icons.mail_outline,
                        color: WardenColors.cyan),
                    title: Text(m.body,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: WardenColors.text)),
                    subtitle: Text(
                      '${m.from.isEmpty ? '?' : m.from}${m.at == null ? '' : ' · ${_fmt(m.at!)}'}',
                      style: const TextStyle(
                          color: WardenColors.textDim, fontSize: 11),
                    ),
                    onTap: () => _showMessage(context, m),
                  ),
                if (messages.isEmpty && mentions.isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(40),
                    child: Center(
                      child: Text('No mail yet.',
                          style: TextStyle(color: WardenColors.textDim)),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }

  void _showMessage(BuildContext context, MailMessage m) {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: WardenColors.surface,
        title: Text(m.from.isEmpty ? 'Message' : 'From ${m.from}',
            style: const TextStyle(color: WardenColors.text, fontSize: 16)),
        content: Text(m.body,
            style: const TextStyle(color: WardenColors.text, fontSize: 14)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close',
                style: TextStyle(color: WardenColors.cyan)),
          ),
        ],
      ),
    );
  }

  void _showMention(BuildContext context, Mention m) {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: WardenColors.surface,
        title: const Text('Mention',
            style: TextStyle(color: WardenColors.text, fontSize: 16)),
        content: Text(m.body,
            style: const TextStyle(color: WardenColors.text, fontSize: 14)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close',
                style: TextStyle(color: WardenColors.cyan)),
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String text;
  const _SectionHeader(this.text);
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 6),
      child: Text(text,
          style: const TextStyle(
              color: WardenColors.textDim,
              fontSize: 12,
              fontWeight: FontWeight.bold,
              letterSpacing: 1)),
    );
  }
}

Future<void> _sendDm(BuildContext context, WidgetRef ref) async {
  final hostCtrl = TextEditingController();
  final msgCtrl = TextEditingController();
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
          TextField(
            controller: hostCtrl,
            style: const TextStyle(color: WardenColors.text),
            decoration: const InputDecoration(
              labelText: 'To (hostname)',
              hintText: 'e.g. forge-vps',
              labelStyle: TextStyle(color: WardenColors.textDim),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: msgCtrl,
            maxLines: 4,
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
              'host': hostCtrl.text.trim(),
              'message': msgCtrl.text,
            }),
            child: const Text('SEND'),
          ),
        ],
      ),
    ),
  );

  if (result == null || (result['message'] ?? '').trim().isEmpty) return;
  try {
    await ref.read(apiProvider).dm(result['host'] ?? '', result['message']!);
    ref.invalidate(_mailProvider);
    if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Sent')));
    }
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Send failed: $e')));
    }
  }
}

String _fmt(DateTime t) {
  final h = t.hour.toString().padLeft(2, '0');
  final m = t.minute.toString().padLeft(2, '0');
  return '${t.month}/${t.day} $h:$m';
}
