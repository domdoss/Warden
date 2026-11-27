import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/providers.dart';
import '../../theme.dart';

/// Image generation. The host composes one photoreal prompt from these fields
/// and runs the local SD.cpp (Qwen-Image Turbo) generator, then serves the PNG.
class ImageGenScreen extends ConsumerStatefulWidget {
  const ImageGenScreen({super.key});

  @override
  ConsumerState<ImageGenScreen> createState() => _ImageGenScreenState();
}

class _ImageGenScreenState extends ConsumerState<ImageGenScreen> {
  final _prompt = TextEditingController();
  final _scene = TextEditingController();
  final _aesthetic = TextEditingController();
  final _location = TextEditingController();
  final _negative = TextEditingController();
  final _seed = TextEditingController();

  bool _generating = false;
  String? _error;
  final List<String> _images = [];
  int _ratio = 0; // 0 square, 1 wide, 2 tall
  Timer? _poll;

  static const _ratios = [
    (label: 'Square', w: 1024, h: 1024),
    (label: 'Wide', w: 1344, h: 768),
    (label: 'Tall', w: 768, h: 1344),
  ];

  // Default starter prompt — a funny meme template so Generate does something
  // amusing out of the box. Fully editable; no fixed subject.
  static const _defaultLook =
      'a smug corgi in a tiny business suit, deadpan expression, meme energy, '
      'sharp focus, high detail';
  static const _defaultScene =
      'sitting at a desk with a tiny laptop, office lighting, '
      'dramatic zoom-in framing';

  @override
  void initState() {
    super.initState();
    _prompt.text = _defaultLook;
    _scene.text = _defaultScene;
    _loadHistory();
    _checkStatus(); // resume if a render is already running on the host
  }

  Future<void> _loadHistory() async {
    try {
      final files = await ref.read(apiProvider).imageGenHistory();
      if (!mounted) return;
      setState(() {
        _images
          ..clear()
          ..addAll(files
              .map((f) => _resolve((f['url'] ?? '').toString()))
              .where((u) => u.isNotEmpty));
      });
    } catch (_) {
      /* history is best-effort */
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    _prompt.dispose();
    _scene.dispose();
    _aesthetic.dispose();
    _location.dispose();
    _negative.dispose();
    _seed.dispose();
    super.dispose();
  }

  String _resolve(String raw) {
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    final base = ref.read(apiProvider).baseUrl;
    return raw.startsWith('/') ? '$base$raw' : '$base/$raw';
  }

  Future<void> _generate() async {
    final prompt = _prompt.text.trim();
    if (prompt.isEmpty) {
      setState(() => _error = 'Describe what you want to create.');
      return;
    }
    setState(() {
      _generating = true;
      _error = null;
    });
    try {
      // Starts the render on the host and returns immediately.
      final r = await ref.read(apiProvider).imageGen(
            prompt: prompt,
            scene: _scene.text,
            aesthetic: _aesthetic.text,
            location: _location.text,
            negative: _negative.text,
            width: _ratios[_ratio].w,
            height: _ratios[_ratio].h,
            seed: int.tryParse(_seed.text.trim()),
          );
      if (!mounted) return;
      if (r['ok'] != true) {
        setState(() {
          _generating = false;
          _error = (r['error'] ?? 'Generation failed').toString();
        });
        return;
      }
      // Rendering in the background now — poll until it's done, no timeout.
      _startPolling();
    } catch (e) {
      if (mounted) {
        setState(() {
          _generating = false;
          _error = '$e';
        });
      }
    }
  }

  void _startPolling() {
    _poll?.cancel();
    _poll = Timer.periodic(const Duration(seconds: 3), (_) => _checkStatus());
  }

  Future<void> _checkStatus() async {
    try {
      final st = await ref.read(apiProvider).imageGenStatus();
      if (!mounted) return;
      if (st['running'] == true) {
        if (!_generating) setState(() => _generating = true);
        if (_poll == null || !_poll!.isActive) _startPolling();
        return;
      }
      _poll?.cancel();
      _poll = null;
      final err = (st['error'] ?? '').toString();
      if (err.isNotEmpty) {
        setState(() {
          _generating = false;
          _error = err;
        });
        return;
      }
      final url = (st['url'] ?? '').toString();
      if (mounted) setState(() => _generating = false);
      await _loadHistory();
      if (url.isNotEmpty) {
        final resolved = _resolve(url);
        if (!_images.contains(resolved) && mounted) {
          setState(() => _images.insert(0, resolved));
        }
      }
    } catch (_) {
      /* transient — retry on the next tick */
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Image Gen')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          const Text(
            'Describe it. Warden builds the prompt and renders it on your machine.',
            style: TextStyle(color: WardenColors.textDim, fontSize: 12),
          ),
          const SizedBox(height: 14),
          _field(
            _prompt,
            'Prompt',
            'A chrome raven on a rooftop at dusk…',
            minLines: 3,
            maxLines: 5,
          ),
          const SizedBox(height: 12),
          _field(
            _scene,
            'Scene',
            'The setting or moment (optional)',
            minLines: 2,
            maxLines: 4,
          ),
          const SizedBox(height: 10),
          Container(
            decoration: BoxDecoration(
              color: WardenColors.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: WardenColors.border),
            ),
            child: Theme(
              data: Theme.of(context)
                  .copyWith(dividerColor: Colors.transparent),
              child: ExpansionTile(
                tilePadding: const EdgeInsets.symmetric(horizontal: 14),
                childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
                iconColor: WardenColors.crimson,
                collapsedIconColor: WardenColors.textDim,
                title: const Text('More options',
                    style: TextStyle(color: WardenColors.textDim, fontSize: 13)),
                children: [
                  _field(_aesthetic, 'Aesthetic', 'cinematic, moody, film grain'),
                  const SizedBox(height: 10),
                  _field(_location, 'Location', 'city rooftop, dusk'),
                  const SizedBox(height: 10),
                  _field(_negative, 'Negative', 'text, watermark, blurry'),
                  const SizedBox(height: 10),
                  _field(_seed, 'Seed', 'random', keyboard: TextInputType.number),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              const Text('Size',
                  style:
                      TextStyle(color: WardenColors.textDim, fontSize: 13)),
              const Spacer(),
              for (var i = 0; i < _ratios.length; i++)
                Padding(
                  padding: const EdgeInsets.only(left: 6),
                  child: ChoiceChip(
                    label: Text(_ratios[i].label,
                        style: TextStyle(
                            color: _ratio == i
                                ? WardenColors.background
                                : WardenColors.text,
                            fontSize: 12)),
                    selected: _ratio == i,
                    selectedColor: WardenColors.crimson,
                    backgroundColor: WardenColors.background,
                    onSelected: (_) => setState(() => _ratio = i),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 14),
          FilledButton.icon(
            style: FilledButton.styleFrom(
              backgroundColor: WardenColors.crimson,
              foregroundColor: WardenColors.background,
              padding: const EdgeInsets.symmetric(vertical: 15),
            ),
            onPressed: _generating ? null : _generate,
            icon: const Icon(Icons.auto_awesome, size: 18),
            label: Text(_generating ? 'GENERATING…' : 'GENERATE'),
          ),
          if (_generating) ...[
            const SizedBox(height: 12),
            const Center(
              child: CircularProgressIndicator(
                  color: WardenColors.crimson, strokeWidth: 2),
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!,
                style: const TextStyle(color: WardenColors.red, fontSize: 12)),
          ],
          if (_images.isNotEmpty) ...[
            const SizedBox(height: 20),
            const Text('GALLERY',
                style: TextStyle(
                    color: WardenColors.textDim,
                    fontSize: 11,
                    letterSpacing: 2)),
            const SizedBox(height: 8),
            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: _images.length,
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 3,
                crossAxisSpacing: 6,
                mainAxisSpacing: 6,
              ),
              itemBuilder: (context, i) => GestureDetector(
                onTap: () => _view(_images[i]),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Image.network(
                    _images[i],
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => Container(
                      color: WardenColors.surfaceAlt,
                      child: const Icon(Icons.broken_image_outlined,
                          color: WardenColors.textDim, size: 20),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _field(
    TextEditingController c,
    String label,
    String hint, {
    int minLines = 1,
    int maxLines = 1,
    TextInputType? keyboard,
  }) {
    return TextField(
      controller: c,
      minLines: minLines,
      maxLines: maxLines,
      keyboardType: keyboard,
      style: const TextStyle(color: WardenColors.text, fontSize: 14),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: WardenColors.textDim),
        hintText: hint,
        hintStyle: const TextStyle(color: WardenColors.textDim, fontSize: 12),
        filled: true,
        fillColor: WardenColors.surface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: WardenColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: WardenColors.border),
        ),
      ),
    );
  }

  void _view(String url) {
    showDialog<void>(
      context: context,
      builder: (context) => Dialog(
        backgroundColor: Colors.black,
        insetPadding: const EdgeInsets.all(12),
        child: Stack(
          children: [
            InteractiveViewer(
              child: Image.network(url, fit: BoxFit.contain),
            ),
            Positioned(
              top: 4,
              right: 4,
              child: IconButton(
                icon: const Icon(Icons.close, color: Colors.white),
                onPressed: () => Navigator.of(context).pop(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
