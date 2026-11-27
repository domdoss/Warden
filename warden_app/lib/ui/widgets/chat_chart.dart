import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';

import '../../theme.dart';

/// Renders a chat message as Markdown, but upgrades fenced code blocks tagged
/// `chart`, `graph`, `data`, or `vega` that contain a JSON chart spec into a
/// real chart. Everything else stays normal Markdown (tables, code, lists…).
///
/// Expected block shape (all keys optional except values):
/// ```chart
/// {"type":"bar","title":"Latency","labels":["Mon","Tue"],"values":[12,9]}
/// ```
/// Also accepts multiple series:
/// `{"type":"line","labels":[...],"series":[{"name":"A","values":[1,2]}]}`
class ChatMarkdown extends StatelessWidget {
  final String data;
  const ChatMarkdown({super.key, required this.data});

  static final _fence = RegExp(
    r'```(chart|graph|data|vega|vega-lite)\s*\n([\s\S]*?)```',
    caseSensitive: false,
  );

  @override
  Widget build(BuildContext context) {
    final segments = <_Seg>[];
    var cursor = 0;
    for (final m in _fence.allMatches(data)) {
      if (m.start > cursor) {
        segments.add(_Seg.text(data.substring(cursor, m.start)));
      }
      final spec = _parse(m.group(2) ?? '');
      if (spec != null) {
        segments.add(_Seg.chart(spec));
      } else {
        // Not valid JSON — keep it as a code block so nothing is lost.
        segments.add(_Seg.text(m.group(0)!));
      }
      cursor = m.end;
    }
    if (cursor < data.length) segments.add(_Seg.text(data.substring(cursor)));
    if (segments.isEmpty) segments.add(_Seg.text(data));

    if (segments.length == 1 && segments.first.isText) {
      return _markdown(segments.first.text ?? '');
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final s in segments)
          s.isText
              ? _markdown((s.text ?? '').trim().isEmpty ? '' : s.text!)
              : Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: ChatChart(spec: s.spec!),
                ),
      ],
    );
  }

  Widget _markdown(String text) => MarkdownBody(
        data: text,
        styleSheet: MarkdownStyleSheet(
          p: const TextStyle(
              color: WardenColors.text, fontSize: 15, height: 1.35),
          code: const TextStyle(
              color: WardenColors.cyan, fontSize: 13, fontFamily: 'monospace'),
          codeblockDecoration: BoxDecoration(
            color: WardenColors.background,
            borderRadius: BorderRadius.circular(8),
          ),
          tableBorder: TableBorder.all(color: WardenColors.border),
          tableCellsPadding: const EdgeInsets.all(6),
          tableHead: const TextStyle(
              color: WardenColors.crimson, fontWeight: FontWeight.bold),
          tableBody: const TextStyle(color: WardenColors.text, fontSize: 13),
        ),
      );

  static ChartSpec? _parse(String raw) {
    try {
      final v = jsonDecode(raw.trim());
      if (v is! Map) return null;
      return ChartSpec.fromJson(Map<String, dynamic>.from(v));
    } catch (_) {
      return null;
    }
  }
}

class _Seg {
  final String? text;
  final ChartSpec? spec;
  const _Seg._(this.text, this.spec);
  factory _Seg.text(String t) => _Seg._(t, null);
  factory _Seg.chart(ChartSpec s) => _Seg._(null, s);
  bool get isText => text != null;
}

class ChartSeries {
  final String name;
  final List<double> values;
  const ChartSeries(this.name, this.values);
}

class ChartSpec {
  final String type; // bar | line | pie
  final String title;
  final List<String> labels;
  final List<ChartSeries> series;

  const ChartSpec({
    required this.type,
    required this.title,
    required this.labels,
    required this.series,
  });

  static List<double> _nums(dynamic v) {
    if (v is! List) return const [];
    return v
        .map((e) => e is num ? e.toDouble() : double.tryParse('$e') ?? 0)
        .toList();
  }

  factory ChartSpec.fromJson(Map<String, dynamic> m) {
    final type = (m['type'] ?? m['chart'] ?? 'bar').toString().toLowerCase();
    final labels = (m['labels'] as List?)
            ?.map((e) => e.toString())
            .toList() ??
        const <String>[];
    final seriesJson = m['series'];
    final series = <ChartSeries>[];
    if (seriesJson is List && seriesJson.isNotEmpty) {
      for (final s in seriesJson) {
        if (s is Map) {
          series.add(ChartSeries(
            (s['name'] ?? '').toString(),
            _nums(s['values'] ?? s['data']),
          ));
        } else {
          series.add(ChartSeries('', _nums(s)));
        }
      }
    } else {
      series.add(ChartSeries((m['name'] ?? '').toString(),
          _nums(m['values'] ?? m['data'])));
    }
    // Pie falls back to the first series; bar/line keep all series.
    return ChartSpec(
      type: type == 'line' || type == 'pie' ? type : 'bar',
      title: (m['title'] ?? '').toString(),
      labels: labels,
      series: series,
    );
  }
}

class ChatChart extends StatelessWidget {
  final ChartSpec spec;
  const ChatChart({super.key, required this.spec});

  static const _palette = [
    WardenColors.crimson,
    WardenColors.cyan,
    WardenColors.green,
    WardenColors.amber,
    Color(0xFF9B7BFF),
    Color(0xFFFF7AC8),
  ];

  @override
  Widget build(BuildContext context) {
    final hasData = spec.series.any((s) => s.values.isNotEmpty);
    if (!hasData) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
      decoration: BoxDecoration(
        color: WardenColors.background,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: WardenColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (spec.title.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 6, left: 2),
              child: Text(
                spec.title,
                style: const TextStyle(
                    color: WardenColors.text,
                    fontSize: 13,
                    fontWeight: FontWeight.w600),
              ),
            ),
          SizedBox(
            height: 190,
            width: double.infinity,
            child: CustomPaint(
              painter: spec.type == 'pie'
                  ? _PiePainter(spec, _palette)
                  : _AxisPainter(spec, _palette),
            ),
          ),
          if (spec.type != 'pie' && spec.series.length > 1) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 12,
              runSpacing: 4,
              children: [
                for (var i = 0; i < spec.series.length; i++)
                  Row(mainAxisSize: MainAxisSize.min, children: [
                    Container(
                      width: 9,
                      height: 9,
                      decoration: BoxDecoration(
                        color: _palette[i % _palette.length],
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                    const SizedBox(width: 5),
                    Text(spec.series[i].name,
                        style: const TextStyle(
                            color: WardenColors.textDim, fontSize: 11)),
                  ]),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

double _niceMax(double v) {
  if (v <= 0) return 1;
  final mag = math.pow(10, (math.log(v) / math.ln10).floor()).toDouble();
  final norm = v / mag;
  final step = norm <= 1
      ? 1
      : norm <= 2
          ? 2
          : norm <= 5
              ? 5
              : 10;
  return step * mag;
}

class _AxisPainter extends CustomPainter {
  final ChartSpec spec;
  final List<Color> palette;
  _AxisPainter(this.spec, this.palette);

  @override
  void paint(Canvas canvas, Size size) {
    const padL = 34.0, padB = 22.0, padT = 6.0, padR = 6.0;
    final plot = Rect.fromLTRB(padL, padT, size.width - padR, size.height - padB);
    if (plot.width <= 0 || plot.height <= 0) return;

    final all = spec.series.expand((s) => s.values);
    final maxV = _niceMax(all.isEmpty ? 1 : all.reduce(math.max));
    final labelCount = spec.labels.isNotEmpty
        ? spec.labels.length
        : spec.series.first.values.length;

    final grid = Paint()
      ..color = WardenColors.border
      ..strokeWidth = 1;
    final axisText = TextPainter(textDirection: TextDirection.ltr);

    // Horizontal gridlines + Y labels.
    for (var i = 0; i <= 4; i++) {
      final y = plot.bottom - plot.height * i / 4;
      canvas.drawLine(Offset(plot.left, y), Offset(plot.right, y), grid);
      final val = maxV * i / 4;
      axisText.text = TextSpan(
        text: val >= 1000 ? '${(val / 1000).toStringAsFixed(1)}k' : val.toStringAsFixed(val % 1 == 0 ? 0 : 1),
        style: const TextStyle(color: WardenColors.textDim, fontSize: 9),
      );
      axisText.layout();
      axisText.paint(canvas, Offset(2, y - axisText.height / 2));
    }

    // X labels.
    final n = math.max(labelCount, 1);
    final slotW = plot.width / n;
    for (var i = 0; i < labelCount; i++) {
      final label = spec.labels.isNotEmpty ? spec.labels[i] : '${i + 1}';
      axisText.text = TextSpan(
        text: label.length > 6 ? '${label.substring(0, 5)}…' : label,
        style: const TextStyle(color: WardenColors.textDim, fontSize: 9),
      );
      axisText.layout();
      final x = spec.type == 'bar'
          ? plot.left + slotW * (i + 0.5) - axisText.width / 2
          : plot.left + (n == 1 ? 0 : plot.width * i / (n - 1)) - axisText.width / 2;
      axisText.paint(canvas, Offset(x.clamp(0, size.width - axisText.width), plot.bottom + 5));
    }

    if (spec.type == 'bar') {
      _paintBars(canvas, plot, slotW, maxV, axisText);
    } else {
      _paintLines(canvas, plot, maxV);
    }
  }

  void _paintBars(Canvas canvas, Rect plot, double slotW, double maxV,
      TextPainter axisText) {
    final seriesCount = spec.series.length;
    final groupW = slotW * 0.7;
    final barW = groupW / seriesCount;
    for (var s = 0; s < seriesCount; s++) {
      final paint = Paint()..color = palette[s % palette.length];
      final vals = spec.series[s].values;
      for (var i = 0; i < vals.length; i++) {
        final h = plot.height * (vals[i] / maxV).clamp(0.0, 1.0);
        final left =
            plot.left + slotW * i + (slotW - groupW) / 2 + barW * s;
        final r = RRect.fromRectAndCorners(
          Rect.fromLTWH(left, plot.bottom - h, math.max(barW - 2, 1), h),
          topLeft: const Radius.circular(3),
          topRight: const Radius.circular(3),
        );
        canvas.drawRRect(r, paint);
      }
    }
  }

  void _paintLines(Canvas canvas, Rect plot, double maxV) {
    for (var s = 0; s < spec.series.length; s++) {
      final vals = spec.series[s].values;
      if (vals.isEmpty) continue;
      final paint = Paint()
        ..color = palette[s % palette.length]
        ..strokeWidth = 2
        ..style = PaintingStyle.stroke;
      final dot = Paint()..color = palette[s % palette.length];
      final path = Path();
      for (var i = 0; i < vals.length; i++) {
        final x = plot.left +
            (vals.length == 1 ? plot.width / 2 : plot.width * i / (vals.length - 1));
        final y = plot.bottom - plot.height * (vals[i] / maxV).clamp(0.0, 1.0);
        if (i == 0) {
          path.moveTo(x, y);
        } else {
          path.lineTo(x, y);
        }
        canvas.drawCircle(Offset(x, y), 2.6, dot);
      }
      canvas.drawPath(path, paint);
    }
  }

  @override
  bool shouldRepaint(covariant _AxisPainter old) =>
      old.spec != spec || old.palette != palette;
}

class _PiePainter extends CustomPainter {
  final ChartSpec spec;
  final List<Color> palette;
  _PiePainter(this.spec, this.palette);

  @override
  void paint(Canvas canvas, Size size) {
    final vals = spec.series.first.values;
    if (vals.isEmpty) return;
    final total = vals.fold<double>(0, (a, b) => a + b);
    if (total <= 0) return;

    final radius = math.min(size.height, size.width * 0.55) / 2 - 6;
    final center = Offset(size.width * 0.3, size.height / 2);
    var start = -math.pi / 2;
    for (var i = 0; i < vals.length; i++) {
      final sweep = 2 * math.pi * vals[i] / total;
      final paint = Paint()..color = palette[i % palette.length];
      canvas.drawArc(
          Rect.fromCircle(center: center, radius: radius), start, sweep, true, paint);
      start += sweep;
    }

    // Legend on the right.
    final tp = TextPainter(textDirection: TextDirection.ltr);
    var y = center.dy - (vals.length * 15) / 2;
    for (var i = 0; i < vals.length; i++) {
      final label = i < spec.labels.length ? spec.labels[i] : 'Item ${i + 1}';
      final pct = (vals[i] / total * 100).toStringAsFixed(0);
      canvas.drawRect(
          Rect.fromLTWH(size.width * 0.58, y + 1, 9, 9),
          Paint()..color = palette[i % palette.length]);
      tp.text = TextSpan(
        text: '$label  $pct%',
        style: const TextStyle(color: WardenColors.textDim, fontSize: 10),
      );
      tp.layout(maxWidth: size.width * 0.4);
      tp.paint(canvas, Offset(size.width * 0.58 + 14, y));
      y += 15;
    }
  }

  @override
  bool shouldRepaint(covariant _PiePainter old) =>
      old.spec != spec || old.palette != palette;
}
