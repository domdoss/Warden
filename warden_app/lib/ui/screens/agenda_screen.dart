import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/models.dart';
import '../../providers/providers.dart';
import '../../theme.dart';
import '../../utils/schedule.dart';

final _tasksProvider =
    FutureProvider<List<Task>>((ref) => ref.watch(apiProvider).tasks());
final _eventsProvider = FutureProvider<List<CalendarEvent>>(
    (ref) => ref.watch(apiProvider).calendarEvents());
final _alarmsProvider =
    FutureProvider<List<Alarm>>((ref) => ref.watch(apiProvider).alarms());

class AgendaScreen extends StatelessWidget {
  const AgendaScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Agenda'),
          bottom: const TabBar(
            labelColor: WardenColors.crimson,
            indicatorColor: WardenColors.crimson,
            unselectedLabelColor: WardenColors.textDim,
            tabs: [
              Tab(text: 'TASKS'),
              Tab(text: 'CALENDAR'),
              Tab(text: 'ALARMS'),
            ],
          ),
        ),
        body: const TabBarView(
          children: [TasksTab(), CalendarTab(), AlarmsTab()],
        ),
      ),
    );
  }
}

class TasksTab extends ConsumerWidget {
  const TasksTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tasks = ref.watch(_tasksProvider);
    return tasks.when(
      loading: () => const _Center(loading: true),
      error: (e, _) => _Center(error: '$e'),
      data: (list) => list.isEmpty
          ? const _Center(error: 'No tasks.')
          : RefreshIndicator(
              onRefresh: () => ref.refresh(_tasksProvider.future),
              child: ListView.builder(
                padding: const EdgeInsets.all(12),
                itemCount: list.length,
                itemBuilder: (context, i) {
                  final t = list[i];
                  final paused = t.status.toLowerCase() == 'paused';
                  return Card(
                    color: paused ? WardenColors.surfaceAlt : WardenColors.surface,
                    child: ListTile(
                      leading: Icon(
                        paused ? Icons.check_circle : Icons.play_circle_outline,
                        color: paused ? WardenColors.green : WardenColors.crimson,
                      ),
                      title: Text(
                        t.title.isEmpty ? '(untitled task)' : t.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: paused
                              ? WardenColors.textDim
                              : WardenColors.text,
                          decoration:
                              paused ? TextDecoration.lineThrough : null,
                        ),
                      ),
                      subtitle: Text(
                        [
                          humanScheduleValue(t.scheduleType, t.schedule),
                          t.status,
                          t.nextRun != null
                              ? 'next ${humanDateTime(t.nextRun!.toIso8601String())}'
                              : '',
                        ].where((s) => s.isNotEmpty).join(' · '),
                        style: const TextStyle(
                            color: WardenColors.textDim, fontSize: 12),
                      ),
                      onTap: () async {
                        final ok = await showDialog<bool>(
                          context: context,
                          builder: (context) => AlertDialog(
                            backgroundColor: WardenColors.surface,
                            title: const Text('Remove task',
                                style: TextStyle(color: WardenColors.text)),
                            content: Text(
                                t.title.isEmpty ? '(untitled task)' : t.title,
                                style: const TextStyle(
                                    color: WardenColors.text)),
                            actions: [
                              TextButton(
                                onPressed: () =>
                                    Navigator.of(context).pop(false),
                                child: const Text('Cancel',
                                    style: TextStyle(
                                        color: WardenColors.textDim)),
                              ),
                              TextButton(
                                onPressed: () =>
                                    Navigator.of(context).pop(true),
                                child: const Text('Remove',
                                    style: TextStyle(
                                        color: WardenColors.red)),
                              ),
                            ],
                          ),
                        );
                        if (ok == true) {
                          await ref.read(apiProvider).deleteTask(t.id);
                          ref.invalidate(_tasksProvider);
                        }
                      },
                    ),
                  );
                },
              ),
            ),
    );
  }
}

class CalendarTab extends ConsumerWidget {
  const CalendarTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final events = ref.watch(_eventsProvider);
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton(
        backgroundColor: WardenColors.crimson,
        foregroundColor: WardenColors.background,
        onPressed: () => _addEvent(context, ref),
        child: const Icon(Icons.add),
      ),
      body: events.when(
        loading: () => const _Center(loading: true),
        error: (e, _) => _Center(error: '$e'),
        data: (list) {
          final upcoming = list.where((e) {
            final t = DateTime.tryParse(e.start);
            return t == null || !t.isBefore(DateTime.now());
          }).toList();
          if (upcoming.isEmpty) {
            return const _Center(error: 'No upcoming events.');
          }
          return RefreshIndicator(
            onRefresh: () => ref.refresh(_eventsProvider.future),
            child: ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: upcoming.length,
              itemBuilder: (context, i) {
                final e = upcoming[i];
                return Card(
                  color: WardenColors.surface,
                  child: ListTile(
                    leading: const Icon(Icons.event,
                        color: WardenColors.crimson),
                    title: Text(e.title,
                        style: const TextStyle(color: WardenColors.text)),
                    subtitle: Text(
                      [humanDateTime(e.start), humanDateTime(e.end), e.location]
                          .where((s) => s.isNotEmpty)
                          .join(' → '),
                      style: const TextStyle(
                          color: WardenColors.textDim, fontSize: 12),
                    ),
                    onTap: () => _showEvent(context, ref, e),
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}

class AlarmsTab extends ConsumerWidget {
  const AlarmsTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final alarms = ref.watch(_alarmsProvider);
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton(
        backgroundColor: WardenColors.crimson,
        foregroundColor: WardenColors.background,
        onPressed: () => _addAlarm(context, ref),
        child: const Icon(Icons.add_alarm),
      ),
      body: alarms.when(
        loading: () => const _Center(loading: true),
        error: (e, _) => _Center(error: '$e'),
        data: (list) => list.isEmpty
            ? const _Center(error: 'No alarms.')
            : RefreshIndicator(
                onRefresh: () => ref.refresh(_alarmsProvider.future),
                child: ListView.builder(
                  padding: const EdgeInsets.all(12),
                  itemCount: list.length,
                  itemBuilder: (context, i) {
                    final a = list[i];
                    return Card(
                      color: WardenColors.surface,
                      child: ListTile(
                        leading: Icon(
                          a.enabled
                              ? Icons.alarm
                              : Icons.alarm_off,
                          color: a.enabled
                              ? WardenColors.amber
                              : WardenColors.textDim,
                        ),
                        title: Text(a.label,
                            style: const TextStyle(color: WardenColors.text)),
                        subtitle: Text(
                          [a.time, a.date, a.repeatType]
                              .where((s) => s.isNotEmpty)
                              .join(' · '),
                          style: const TextStyle(
                              color: WardenColors.textDim, fontSize: 12),
                        ),
                        onTap: () async {
                          await ref
                              .read(apiProvider)
                              .updateAlarm(a.id, {'enabled': !a.enabled});
                          ref.invalidate(_alarmsProvider);
                        },
                      ),
                    );
                  },
                ),
              ),
      ),
    );
  }
}

Future<void> _addEvent(BuildContext context, WidgetRef ref) async {
  final title = TextEditingController();
  final start = TextEditingController();
  final ok = await _prompt(context, [
    ('Title', title),
    ('Start (YYYY-MM-DD HH:MM)', start),
  ]);
  if (ok == null || title.text.trim().isEmpty) return;
  try {
    await ref
        .read(apiProvider)
        .addCalendarEvent({'title': title.text.trim(), 'start_time': start.text.trim()});
    ref.invalidate(_eventsProvider);
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Failed: $e')));
    }
  }
}

Future<void> _showEvent(
    BuildContext context, WidgetRef ref, CalendarEvent e) async {
  final del = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      backgroundColor: WardenColors.surface,
      title:
          Text(e.title, style: const TextStyle(color: WardenColors.text)),
      content: Text(
        [humanDateTime(e.start), humanDateTime(e.end), e.location]
            .where((s) => s.isNotEmpty)
            .join('\n'),
        style: const TextStyle(color: WardenColors.text, fontSize: 14),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Close',
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
  if (del == true) {
    try {
      await ref.read(apiProvider).deleteCalendarEvent(e.id);
      ref.invalidate(_eventsProvider);
    } catch (err) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Failed: $err')));
      }
    }
  }
}

Future<void> _addAlarm(BuildContext context, WidgetRef ref) async {
  final label = TextEditingController();
  final time = TextEditingController();
  final ok = await _prompt(context, [
    ('Label', label),
    ('Time (HH:MM)', time),
  ]);
  if (ok == null || label.text.trim().isEmpty || time.text.trim().isEmpty) return;
  try {
    await ref
        .read(apiProvider)
        .addAlarm({'label': label.text.trim(), 'alarm_time': time.text.trim()});
    ref.invalidate(_alarmsProvider);
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Failed: $e')));
    }
  }
}

Future<bool?> _prompt(
    BuildContext context, List<(String, TextEditingController)> fields) {
  return showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      backgroundColor: WardenColors.surface,
      title: const Text('New', style: TextStyle(color: WardenColors.text)),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final (label, ctrl) in fields)
            TextField(
              controller: ctrl,
              style: const TextStyle(color: WardenColors.text),
              decoration: InputDecoration(
                labelText: label,
                labelStyle: const TextStyle(color: WardenColors.textDim),
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
          child: const Text('Save',
              style: TextStyle(color: WardenColors.crimson)),
        ),
      ],
    ),
  );
}

class _Center extends StatelessWidget {
  final bool loading;
  final String? error;
  const _Center({this.loading = false, this.error});

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Center(
          child: CircularProgressIndicator(color: WardenColors.crimson));
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

