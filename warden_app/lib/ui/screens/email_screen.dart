import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/providers.dart';
import '../../theme.dart';

final _accountsProvider = FutureProvider<List<dynamic>>(
    (ref) => ref.watch(apiProvider).emailAccounts());
final _inboxProvider = FutureProvider.family<List<dynamic>, String>(
    (ref, accountId) => ref.watch(apiProvider).emailInbox(accountId));

class EmailScreen extends ConsumerStatefulWidget {
  const EmailScreen({super.key});

  @override
  ConsumerState<EmailScreen> createState() => _EmailScreenState();
}

class _EmailScreenState extends ConsumerState<EmailScreen> {
  String? _accountId;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => _pickAccount());
  }

  Future<void> _pickAccount() async {
    try {
      final accounts = await ref.read(apiProvider).emailAccounts();
      if (!mounted) return;
      if (accounts.isNotEmpty) {
        final a = accounts.first;
        final id = a is Map
            ? (a['id'] ?? a['email'] ?? a['name'] ?? '').toString()
            : a.toString();
        setState(() => _accountId = id);
      }
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final accounts = ref.watch(_accountsProvider);
    final acct = _accountId;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Email'),
        actions: [
          if (accounts.valueOrNull != null && accounts.valueOrNull!.isNotEmpty)
            DropdownButton<String>(
              underline: const SizedBox(),
              dropdownColor: WardenColors.surface,
              value: acct,
              iconEnabledColor: WardenColors.crimson,
              onChanged: (v) => setState(() => _accountId = v),
              items: accounts.valueOrNull!
                  .map((a) {
                    final id = a is Map
                        ? (a['id'] ?? a['email'] ?? a['name'] ?? '').toString()
                        : a.toString();
                    final label = a is Map
                        ? (a['name'] ?? a['email'] ?? id).toString()
                        : id;
                    return DropdownMenuItem(value: id, child: Text(label));
                  })
                  .toList(),
            ),
        ],
      ),
      floatingActionButton: acct == null
          ? null
          : FloatingActionButton(
              backgroundColor: WardenColors.crimson,
              foregroundColor: WardenColors.background,
              onPressed: () => _compose(context, ref, acct),
              child: const Icon(Icons.edit_outlined),
            ),
      body: acct == null
          ? const Center(
              child: Text('No email account configured.',
                  style: TextStyle(color: WardenColors.textDim)))
          : ref.watch(_inboxProvider(acct)).when(
                loading: () => const Center(
                    child: CircularProgressIndicator(
                        color: WardenColors.crimson)),
                error: (e, _) => Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.cloud_off,
                            color: WardenColors.textDim, size: 36),
                        const SizedBox(height: 12),
                        const Text(
                          "Couldn't load the inbox.",
                          style: TextStyle(
                              color: WardenColors.text,
                              fontSize: 16,
                              fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 6),
                        const Text(
                          'The mailbox account on your Warden host may need checking (IMAP access, credentials, or the mail server).',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                              color: WardenColors.textDim, fontSize: 12),
                        ),
                        const SizedBox(height: 16),
                        OutlinedButton(
                          onPressed: () =>
                              ref.invalidate(_inboxProvider(acct)),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: WardenColors.cyan,
                            side: BorderSide(
                                color:
                                    WardenColors.cyan.withValues(alpha: 0.4)),
                          ),
                          child: const Text('Retry'),
                        ),
                      ],
                    ),
                  ),
                ),
                data: (emails) => emails.isEmpty
                    ? const Center(
                        child: Text('Inbox empty.',
                            style: TextStyle(color: WardenColors.textDim)))
                    : RefreshIndicator(
                        onRefresh: () =>
                            ref.refresh(_inboxProvider(acct).future),
                        child: ListView.builder(
                          itemCount: emails.length,
                          itemBuilder: (context, i) {
                            final e = emails[i];
                            final from = e is Map ? (e['from'] ?? '').toString() : '';
                            final subject =
                                e is Map ? (e['subject'] ?? '').toString() : '';
                            final id = e is Map ? (e['id'] ?? e['uid'] ?? '').toString() : '';
                            return ListTile(
                              leading: const Icon(Icons.mail_outline,
                                  color: WardenColors.crimson),
                              title: Text(subject.isEmpty ? '(no subject)' : subject,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                      color: WardenColors.text)),
                              subtitle: Text(from,
                                  style: const TextStyle(
                                      color: WardenColors.textDim,
                                      fontSize: 12)),
                              onTap: () => _open(context, acct, id),
                            );
                          },
                        ),
                      ),
              ),
    );
  }

  void _open(BuildContext context, String acct, String emailId) async {
    try {
      final r = await ref.read(apiProvider).emailMessage(acct, emailId);
      if (!context.mounted) return;
      final email = r['email'];
      final body = email is Map
          ? (email['body'] ?? email['text'] ?? email['html'] ?? '').toString()
          : '';
      final subject =
          email is Map ? (email['subject'] ?? '').toString() : '';
      final from = email is Map ? (email['from'] ?? '').toString() : '';
      showDialog(
        context: context,
        builder: (_) => AlertDialog(
          backgroundColor: WardenColors.surface,
          title: Text(subject.isEmpty ? '(no subject)' : subject,
              style: const TextStyle(color: WardenColors.text, fontSize: 16)),
          content: SizedBox(
            width: double.maxFinite,
            child: SingleChildScrollView(
              child: Text('From: $from\n\n$body',
                  style: const TextStyle(
                      color: WardenColors.text, fontSize: 14)),
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
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }
}

Future<void> _compose(BuildContext context, WidgetRef ref, String acct) async {
  final to = TextEditingController();
  final subject = TextEditingController();
  final body = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      backgroundColor: WardenColors.surface,
      title: const Text('Compose', style: TextStyle(color: WardenColors.text)),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: to,
            style: const TextStyle(color: WardenColors.text),
            decoration: const InputDecoration(
                labelText: 'To', labelStyle: TextStyle(color: WardenColors.textDim)),
          ),
          TextField(
            controller: subject,
            style: const TextStyle(color: WardenColors.text),
            decoration: const InputDecoration(
                labelText: 'Subject',
                labelStyle: TextStyle(color: WardenColors.textDim)),
          ),
          TextField(
            controller: body,
            maxLines: 4,
            style: const TextStyle(color: WardenColors.text),
            decoration: const InputDecoration(
                labelText: 'Body', labelStyle: TextStyle(color: WardenColors.textDim)),
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
          child: const Text('Send', style: TextStyle(color: WardenColors.crimson)),
        ),
      ],
    ),
  );
  if (ok == true && to.text.trim().isNotEmpty) {
    try {
      await ref.read(apiProvider).emailSend({
        'accountId': acct,
        'to': to.text.trim(),
        'subject': subject.text,
        'body': body.text,
      });
      ref.invalidate(_inboxProvider(acct));
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
}
