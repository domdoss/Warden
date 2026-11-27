import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/providers.dart';
import '../../theme.dart';
import '../../utils/schedule.dart';

final _heartbeatProvider = FutureProvider<Map<String, dynamic>>(
    (ref) => ref.watch(apiProvider).heartbeat());

class HeartbeatScreen extends ConsumerWidget {
  const HeartbeatScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final h = ref.watch(_heartbeatProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Heartbeat')),
      body: h.when(
        loading: () => const Center(
            child: CircularProgressIndicator(color: WardenColors.crimson)),
        error: (e, _) => Center(
            child: Text('$e', style: const TextStyle(color: WardenColors.textDim))),
        data: (d) {
          final enabled = d['enabled'] == true;
          final content = (d['content'] ?? '').toString();
          final cron = (d['cron'] ?? '').toString();
          final lastRun = (d['lastRun'] ?? '').toString();
          final model = (d['model'] ?? '').toString();

          return RefreshIndicator(
            onRefresh: () => ref.refresh(_heartbeatProvider.future),
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                SwitchListTile(
                  title: const Text('Enabled',
                      style: TextStyle(color: WardenColors.text)),
                  subtitle: const Text(
                      'Sends the heartbeat message on schedule',
                      style: TextStyle(color: WardenColors.textDim, fontSize: 12)),
                  activeThumbColor: WardenColors.crimson,
                  value: enabled,
                  onChanged: (v) async {
                    try {
                      await ref
                          .read(apiProvider)
                          .heartbeatUpdate({'enabled': v});
                      ref.invalidate(_heartbeatProvider);
                    } catch (e) {
                      if (context.mounted) {
                        ScaffoldMessenger.of(context)
                            .showSnackBar(SnackBar(content: Text('$e')));
                      }
                    }
                  },
                ),
                _row('Schedule', humanCron(cron)),
                _row('Last run', humanDateTime(lastRun)),
                _row('Model', model),
                const SizedBox(height: 16),
                Card(
                  color: WardenColors.surface,
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('MESSAGE',
                            style: TextStyle(
                                color: WardenColors.textDim,
                                fontSize: 11,
                                letterSpacing: 2)),
                        const SizedBox(height: 8),
                        Text(content.isEmpty ? '(none)' : content,
                            style: const TextStyle(color: WardenColors.text)),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _row(String k, String v) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(k,
                style: const TextStyle(
                    color: WardenColors.textDim, fontSize: 13)),
          ),
          Expanded(
            child: Text(v.isEmpty ? '—' : v,
                style: const TextStyle(color: WardenColors.text)),
          ),
        ],
      ),
    );
  }
}
