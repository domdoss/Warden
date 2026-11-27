import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/providers.dart';
import '../../theme.dart';

/// Strip ANSI escape/terminal-control noise (spinners, cursor moves, `[K`
/// clears) from a raw log tail so it renders as readable plain text.
String _cleanLog(String s) {
  if (s.isEmpty) return s;
  var out = s
      // OSC sequences: ESC ] ... BEL or ESC \
      .replaceAll(RegExp(r'\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)'), '')
      // CSI sequences: ESC [ params intermediates final
      .replaceAll(RegExp(r'\x1B\[[0-?]*[ -/]*[@-~]'), '')
      // Two-char escapes (ESC c, ESC =, …)
      .replaceAll(RegExp(r'\x1B[@-_]'), '');
  // Terminal progress rewrites a line with \r; keep the final state per line.
  final lines = <String>[];
  for (final raw in out.split('\n')) {
    final parts = raw.split('\r');
    final last = parts.lastWhere((p) => p.trim().isNotEmpty, orElse: () => '');
    if (last.trim().isNotEmpty) lines.add(last);
  }
  out = lines.join('\n');
  // Drop leftover control chars and braille spinner glyphs.
  out = out
      .replaceAll(RegExp(r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]'), '')
      .replaceAll(RegExp(r'[\u2800-\u28FF]'), '');
  return out.trim();
}

/// Shared chrome for a settings sub-card.
class _Card extends StatelessWidget {
  final String title;
  final Widget child;
  const _Card({required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: WardenColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: WardenColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style: const TextStyle(
                  color: WardenColors.textDim,
                  fontSize: 11,
                  letterSpacing: 2)),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }
}

class _ModelRow extends StatelessWidget {
  final String label;
  final String value;
  final VoidCallback onTap;
  const _ModelRow({required this.label, required this.value, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          children: [
            SizedBox(
              width: 96,
              child: Text(label,
                  style: const TextStyle(
                      color: WardenColors.textDim, fontSize: 13)),
            ),
            Expanded(
              child: Text(
                value.isEmpty ? '— tap to choose —' : value,
                style: TextStyle(
                    color: value.isEmpty
                        ? WardenColors.textDim
                        : WardenColors.text,
                    fontSize: 14),
              ),
            ),
            const Icon(Icons.expand_more, color: WardenColors.textDim, size: 20),
          ],
        ),
      ),
    );
  }
}

Future<String?> _pickModel(
  BuildContext context,
  String title,
  String current,
  List<String> options,
) async {
  final ctrl = TextEditingController(text: current);
  final picked = await showModalBottomSheet<String>(
    context: context,
    backgroundColor: WardenColors.surface,
    isScrollControlled: true,
    builder: (context) {
      return SafeArea(
        child: Padding(
          padding: EdgeInsets.only(
              bottom: MediaQuery.of(context).viewInsets.bottom),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
                child: Text(title,
                    style: const TextStyle(
                        color: WardenColors.text,
                        fontSize: 15,
                        fontWeight: FontWeight.w600)),
              ),
              if (options.isNotEmpty)
                Flexible(
                  child: ListView(
                    shrinkWrap: true,
                    children: [
                      for (final o in options)
                        ListTile(
                          dense: true,
                          title: Text(o,
                              style: const TextStyle(
                                  color: WardenColors.text, fontSize: 13)),
                          trailing: o == current
                              ? const Icon(Icons.check,
                                  color: WardenColors.crimson, size: 18)
                              : null,
                          onTap: () => Navigator.of(context).pop(o),
                        ),
                    ],
                  ),
                ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: ctrl,
                        style: const TextStyle(color: WardenColors.text),
                        decoration: const InputDecoration(
                          hintText: 'type a model name',
                          hintStyle:
                              TextStyle(color: WardenColors.textDim, fontSize: 12),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    TextButton(
                      onPressed: () =>
                          Navigator.of(context).pop(ctrl.text.trim()),
                      child: const Text('Use',
                          style: TextStyle(color: WardenColors.crimson)),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      );
    },
  );
  return (picked == null || picked.isEmpty) ? null : picked;
}

// ───────────────────────────── Models ─────────────────────────────

class ModelsCard extends ConsumerStatefulWidget {
  const ModelsCard({super.key});
  @override
  ConsumerState<ModelsCard> createState() => _ModelsCardState();
}

class _ModelsCardState extends ConsumerState<ModelsCard> {
  bool _loading = true;
  bool _saving = false;
  String? _error;
  List<String> _models = const [];
  String _atlas = '';
  String _vulkan = '';
  String _toolcall = '';
  bool _escalate = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final api = ref.read(apiProvider);
      final s = await api.settings();
      final models = await api.allModels();
      if (!mounted) return;
      setState(() {
        _atlas = (s['atlasModel'] ?? '').toString();
        _vulkan = (s['vulkanModel'] ?? '').toString();
        _toolcall = (s['irisModel'] ?? '').toString();
        _escalate = s['escalateVulkan'] == true;
        _models = models;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = '$e';
      });
    }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await ref.read(apiProvider).saveSettings({
        'atlasModel': _atlas,
        'vulkanModel': _vulkan,
        'irisModel': _toolcall,
        'escalateVulkan': _escalate,
      });
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Models saved')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Save failed: $e')));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _choose(String title, String cur, void Function(String) set) async {
    final v = await _pickModel(context, title, cur, _models);
    if (v != null) set(v);
  }

  @override
  Widget build(BuildContext context) {
    return _Card(
      title: 'MODELS',
      child: _loading
          ? const Padding(
              padding: EdgeInsets.all(8),
              child: Center(
                  child: CircularProgressIndicator(
                      color: WardenColors.crimson, strokeWidth: 2)),
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (_error != null)
                  Text('Could not load models: $_error',
                      style: const TextStyle(
                          color: WardenColors.red, fontSize: 12)),
                _ModelRow(
                  label: 'Atlas',
                  value: _atlas,
                  onTap: () => _choose('Atlas (background)', _atlas,
                      (v) => setState(() => _atlas = v)),
                ),
                _ModelRow(
                  label: 'Vulkan',
                  value: _vulkan,
                  onTap: () => _choose('Vulkan (coding)', _vulkan,
                      (v) => setState(() => _vulkan = v)),
                ),
                _ModelRow(
                  label: 'Toolcall',
                  value: _toolcall,
                  onTap: () => _choose('Toolcall (Iris)', _toolcall,
                      (v) => setState(() => _toolcall = v)),
                ),
                const Divider(color: WardenColors.border, height: 20),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  activeThumbColor: WardenColors.crimson,
                  title: const Text('Escalate chat to Vulkan',
                      style: TextStyle(color: WardenColors.text, fontSize: 14)),
                  subtitle: const Text(
                      'Run the main seat on the Vulkan model until you turn it off.',
                      style: TextStyle(
                          color: WardenColors.textDim, fontSize: 11)),
                  value: _escalate,
                  onChanged: (v) => setState(() => _escalate = v),
                ),
                Align(
                  alignment: Alignment.centerRight,
                  child: FilledButton(
                    style: FilledButton.styleFrom(
                        backgroundColor: WardenColors.crimson,
                        foregroundColor: WardenColors.background),
                    onPressed: _saving ? null : _save,
                    child: Text(_saving ? 'SAVING…' : 'SAVE'),
                  ),
                ),
              ],
            ),
    );
  }
}

// ───────────────────────────── Training ─────────────────────────────

class TrainingCard extends ConsumerStatefulWidget {
  const TrainingCard({super.key});
  @override
  ConsumerState<TrainingCard> createState() => _TrainingCardState();
}

class _TrainingCardState extends ConsumerState<TrainingCard> {
  bool _loading = true;
  bool _busy = false;
  String? _error;
  String? _running;
  String _tail = '';
  List<String> _models = const [];
  String _model = '';
  int _pendingFlags = 0;
  int _days = 3;
  bool _locked = false;
  int _vramGb = 0;
  String _hwKind = 'none';
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final api = ref.read(apiProvider);
      final st = await api.trainingStatus();
      final md = await api.trainingModels();
      final fl = await api.trainingFlags();
      final allModels = await api.allModels();
      if (!mounted) return;
      final counts = (fl['counts'] as Map?) ?? const {};
      final runRaw = st['running'];
      final run = (runRaw is String && runRaw.isNotEmpty) ? runRaw : null;
      final hw = (st['hardware'] as Map?) ?? const {};
      setState(() {
        _running = run;
        _tail = _cleanLog((st['tail'] ?? '').toString());
        _models = allModels;
        _model = (md['current'] ?? '').toString();
        _pendingFlags = (counts['pending'] as num?)?.toInt() ?? 0;
        _locked = st['locked'] == true;
        _hwKind = (hw['kind'] ?? 'none').toString();
        _vramGb = ((hw['gb'] as num?) ?? 0).toInt();
        _loading = false;
        _error = null;
      });
      _syncPoll();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = '$e';
      });
    }
  }

  void _syncPoll() {
    _poll?.cancel();
    if (_running != null) {
      _poll = Timer.periodic(const Duration(seconds: 4), (_) => _load());
    }
  }

  Future<void> _saveModel() async {
    try {
      await ref.read(apiProvider).trainingSetModel(_model);
    } catch (_) {}
  }

  Future<void> _run(String label, Future<Map<String, dynamic>> Function() fn) async {
    setState(() => _busy = true);
    try {
      await _saveModel();
      final r = await fn();
      if (!mounted) return;
      if (r['ok'] != true) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('$label failed: ${r['error'] ?? 'unknown'}')));
      }
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$label failed: $e')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _stop() async {
    setState(() => _busy = true);
    try {
      await ref.read(apiProvider).trainingStop();
      await _load();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _addError() async {
    const classes = [
      'wrong_tool',
      'bad_arguments',
      'narrated_no_call',
      'call_as_text',
      'wrong_shape',
      'dead_end_no_tools',
      'refusal',
      'hallucinated_answer',
    ];
    var cls = classes.first;
    final wrong = TextEditingController();
    final correct = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          backgroundColor: WardenColors.surface,
          title: const Text('Add a training error',
              style: TextStyle(color: WardenColors.text, fontSize: 16)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  value: cls,
                  dropdownColor: WardenColors.surface,
                  decoration: const InputDecoration(
                    labelText: 'Failure class',
                    labelStyle: TextStyle(color: WardenColors.textDim),
                  ),
                  items: [
                    for (final c in classes)
                      DropdownMenuItem(
                          value: c,
                          child: Text(c,
                              style: const TextStyle(
                                  color: WardenColors.text, fontSize: 13))),
                  ],
                  onChanged: (v) => setLocal(() => cls = v ?? cls),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: wrong,
                  minLines: 2,
                  maxLines: 5,
                  style: const TextStyle(color: WardenColors.text),
                  decoration: const InputDecoration(
                    labelText: 'What went wrong',
                    labelStyle: TextStyle(color: WardenColors.textDim),
                    hintText: 'Paste the bad turn / describe the error.',
                    hintStyle:
                        TextStyle(color: WardenColors.textDim, fontSize: 12),
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: correct,
                  minLines: 2,
                  maxLines: 5,
                  style: const TextStyle(color: WardenColors.text),
                  decoration: const InputDecoration(
                    labelText: 'What it should do',
                    labelStyle: TextStyle(color: WardenColors.textDim),
                    hintStyle:
                        TextStyle(color: WardenColors.textDim, fontSize: 12),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel',
                  style: TextStyle(color: WardenColors.textDim)),
            ),
            TextButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Add',
                  style: TextStyle(color: WardenColors.crimson)),
            ),
          ],
        ),
      ),
    );
    if (ok != true) return;
    if (wrong.text.trim().isEmpty || correct.text.trim().isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Both fields are required.')));
      }
      return;
    }
    try {
      final r = await ref.read(apiProvider).trainingAddFlag({
        'failure_class': cls,
        'log_excerpt': wrong.text.trim(),
        'what_went_wrong': wrong.text.trim(),
        'correct_behavior': correct.text.trim(),
        'tools_relevant': <String>[],
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(r['ok'] == true
              ? 'Error queued for the next modify run'
              : 'Failed: ${r['error'] ?? 'unknown'}')));
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Failed: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final running = _running;
    return _Card(
      title: 'TRAINING LOOP',
      child: _loading
          ? const Padding(
              padding: EdgeInsets.all(8),
              child: Center(
                  child: CircularProgressIndicator(
                      color: WardenColors.crimson, strokeWidth: 2)),
            )
          : _locked
              ? _buildLocked(context)
              : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                        width: 9,
                        height: 9,
                        decoration: BoxDecoration(
                            color: running != null
                                ? WardenColors.amber
                                : WardenColors.textDim,
                            shape: BoxShape.circle)),
                    const SizedBox(width: 8),
                    Text(running != null ? 'RUNNING · $running' : 'IDLE',
                        style: TextStyle(
                            color: running != null
                                ? WardenColors.amber
                                : WardenColors.textDim,
                            fontSize: 13,
                            fontWeight: FontWeight.w600)),
                    const Spacer(),
                    if (_pendingFlags > 0)
                      Text('$_pendingFlags flagged',
                          style: const TextStyle(
                              color: WardenColors.crimson, fontSize: 11)),
                  ],
                ),
                const SizedBox(height: 4),
                const Text(
                  'Audit mines the service log for failures, modify writes the '
                  'corrections, train runs one epoch. Chat locks and schedules '
                  'pause while a step runs.',
                  style: TextStyle(color: WardenColors.textDim, fontSize: 11),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text('Could not load: $_error',
                      style: const TextStyle(
                          color: WardenColors.red, fontSize: 12)),
                ],
                const SizedBox(height: 8),
                _ModelRow(
                  label: 'Analyst',
                  value: _model,
                  onTap: () async {
                    final v = await _pickModel(
                        context, 'Reading / modifying model', _model, _models);
                    if (v != null) {
                      setState(() => _model = v);
                      await _saveModel();
                    }
                  },
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    const Text('Audit window',
                        style: TextStyle(
                            color: WardenColors.textDim, fontSize: 13)),
                    const Spacer(),
                    for (final d in [1, 3, 7])
                      Padding(
                        padding: const EdgeInsets.only(left: 6),
                        child: ChoiceChip(
                          label: Text('${d}d',
                              style: TextStyle(
                                  color: _days == d
                                      ? WardenColors.background
                                      : WardenColors.text,
                                  fontSize: 12)),
                          selected: _days == d,
                          selectedColor: WardenColors.crimson,
                          backgroundColor: WardenColors.background,
                          onSelected: (_) => setState(() => _days = d),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        style: OutlinedButton.styleFrom(
                            foregroundColor: WardenColors.cyan,
                            side: const BorderSide(color: WardenColors.cyan)),
                        onPressed: (_busy || running != null)
                            ? null
                            : () => _run('Audit',
                                () => ref.read(apiProvider).trainingAudit(_days)),
                        child: const Text('AUDIT'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton(
                        style: OutlinedButton.styleFrom(
                            foregroundColor: WardenColors.amber,
                            side: const BorderSide(color: WardenColors.amber)),
                        onPressed: (_busy || running != null)
                            ? null
                            : () => _run('Modify',
                                () => ref.read(apiProvider).trainingModify()),
                        child: const Text('MODIFY'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: FilledButton.icon(
                        style: FilledButton.styleFrom(
                          backgroundColor: WardenColors.crimson,
                          foregroundColor: WardenColors.background,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                        ),
                        onPressed: (_busy || running != null)
                            ? null
                            : () => _run('Train',
                                () => ref.read(apiProvider).trainingTrain()),
                        icon: const Icon(Icons.play_arrow, size: 18),
                        label: const Text('TRAIN'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        foregroundColor: WardenColors.red,
                        side: const BorderSide(color: WardenColors.red),
                        padding: const EdgeInsets.symmetric(
                            vertical: 14, horizontal: 14),
                      ),
                      onPressed: (_busy || running == null) ? null : _stop,
                      child: const Text('STOP'),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: _addError,
                    icon: const Icon(Icons.add_comment_outlined,
                        size: 16, color: WardenColors.crimson),
                    label: const Text('Add your own error',
                        style: TextStyle(
                            color: WardenColors.crimson, fontSize: 13)),
                  ),
                ),
                if (_tail.trim().isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: WardenColors.background,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: WardenColors.border),
                    ),
                    child: Text(
                      _tail,
                      maxLines: 12,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          color: WardenColors.text,
                          fontSize: 11,
                          fontFamily: 'monospace',
                          height: 1.35),
                    ),
                  ),
                ],
              ],
            ),
    );
  }

  /// Shown when the Warden host reports the machine can't run the loop
  /// (no NVIDIA GPU with 16 GB+ VRAM). Offers the cloud-training upsell.
  Widget _buildLocked(BuildContext context) {
    final detected = _hwKind == 'nvidia'
        ? (_vramGb > 0 ? '$_vramGb GB VRAM' : 'NVIDIA GPU')
        : 'no capable NVIDIA GPU';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              width: 9,
              height: 9,
              decoration: const BoxDecoration(
                  color: WardenColors.amber, shape: BoxShape.circle),
            ),
            const SizedBox(width: 8),
            const Text('LOCKED',
                style: TextStyle(
                    color: WardenColors.amber,
                    fontSize: 13,
                    fontWeight: FontWeight.w600)),
          ],
        ),
        const SizedBox(height: 8),
        const Text(
          "Your computer can't run the training loop. It needs an NVIDIA GPU "
          'with 16 GB or more VRAM.',
          style: TextStyle(color: WardenColors.textDim, fontSize: 12),
        ),
        const SizedBox(height: 4),
        Text('Detected: $detected (needs 16 GB+)',
            style: const TextStyle(color: WardenColors.textDim, fontSize: 11)),
        const SizedBox(height: 14),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              foregroundColor: WardenColors.textDim,
              side: const BorderSide(color: WardenColors.border),
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
            onPressed: () => _comingSoon(context),
            icon: const Icon(Icons.cloud_outlined, size: 18),
            label: const Text('Have us train it'),
          ),
        ),
        const SizedBox(height: 6),
        const Text('Cloud training — coming soon',
            style: TextStyle(color: WardenColors.textDim, fontSize: 11)),
      ],
    );
  }

  Future<void> _comingSoon(BuildContext context) async {
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: WardenColors.surface,
        title: const Text('Cloud training',
            style: TextStyle(color: WardenColors.text, fontSize: 16)),
        content: const Text(
          "Your machine can't run the local training loop.\n\n"
          'Have us train it for you — coming soon.',
          style: TextStyle(color: WardenColors.textDim, fontSize: 13),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('OK',
                style: TextStyle(color: WardenColors.crimson)),
          ),
        ],
      ),
    );
  }
}
