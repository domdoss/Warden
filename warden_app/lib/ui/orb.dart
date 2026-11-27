import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme.dart';

/// The assistant's "face": an animated hologram orb that reacts to
/// conversation state and audio level — ChatGPT voice-mode, but Warden's look.
enum OrbState { idle, listening, processing, speaking, error }

class HologramOrb extends StatefulWidget {
  final OrbState state;
  final double level; // 0..1 (mic level when listening / speech when speaking)
  final double size;

  const HologramOrb({
    super.key,
    required this.state,
    this.level = 0.0,
    this.size = 96,
  });

  @override
  State<HologramOrb> createState() => _HologramOrbState();
}

class _HologramOrbState extends State<HologramOrb>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 8),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Color get _color {
    switch (widget.state) {
      case OrbState.idle:
        return WardenColors.cyan;
      case OrbState.listening:
        return WardenColors.red;
      case OrbState.processing:
        return WardenColors.amber;
      case OrbState.speaking:
        return WardenColors.cyan;
      case OrbState.error:
        return WardenColors.red;
    }
  }

  double get _speed {
    switch (widget.state) {
      case OrbState.idle:
        return 0.5;
      case OrbState.listening:
        return 1.0;
      case OrbState.processing:
        return 2.4;
      case OrbState.speaking:
        return 1.2;
      case OrbState.error:
        return 3.0;
    }
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: widget.size,
      height: widget.size,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) => CustomPaint(
          painter: _OrbPainter(
            t: _controller.value,
            color: _color,
            level: widget.level,
            speed: _speed,
            error: widget.state == OrbState.error,
          ),
        ),
      ),
    );
  }
}

class _OrbPainter extends CustomPainter {
  final double t;
  final Color color;
  final double level;
  final double speed;
  final bool error;

  _OrbPainter({
    required this.t,
    required this.color,
    required this.level,
    required this.speed,
    required this.error,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    final r = size.shortestSide / 2;
    final base = (error && (t * 8).floor() % 2 == 0) ? 0.35 : 1.0;

    // soft core glow
    final coreGlow = Paint()
      ..shader = RadialGradient(colors: [
        color.withValues(alpha: 0.55 * base),
        color.withValues(alpha: 0.0),
      ]).createShader(Rect.fromCircle(center: c, radius: r * 0.95));
    canvas.drawCircle(c, r * 0.95, coreGlow);

    // core disc, pulsing with the audio level
    final coreRadius = r * (0.30 + 0.16 * level * base);
    final core = Paint()
      ..shader = RadialGradient(colors: [
        Colors.white.withValues(alpha: 0.9 * base),
        color.withValues(alpha: 0.8 * base),
      ]).createShader(Rect.fromCircle(center: c, radius: coreRadius * 1.2));
    canvas.drawCircle(c, coreRadius, core);

    // rotating dashed rings
    for (var ring = 0; ring < 3; ring++) {
      final ringR = r * (0.52 + ring * 0.16);
      final spin = t * speed * (ring.isEven ? 1 : -1);
      final arc = Paint()
        ..color = color.withValues(alpha: 0.55 * base)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.4
        ..strokeCap = StrokeCap.round;
      const segments = 6;
      final segAngle = (math.pi * 2) / segments;
      for (var s = 0; s < segments; s++) {
        final start = spin + s * segAngle;
        canvas.drawArc(
          Rect.fromCircle(center: c, radius: ringR),
          start,
          segAngle * 0.5,
          false,
          arc,
        );
      }
    }

    // orbiting particles
    final particles = Paint()..color = color.withValues(alpha: 0.9 * base);
    for (var p = 0; p < 5; p++) {
      final angle = t * speed * 2.2 + p * (math.pi * 2 / 5);
      final orbitR = r * (0.62 + (p % 2) * 0.22);
      final pos = Offset(
        c.dx + math.cos(angle) * orbitR,
        c.dy + math.sin(angle) * orbitR,
      );
      canvas.drawCircle(pos, 2.2 + (p % 2), particles);
    }
  }

  @override
  bool shouldRepaint(_OrbPainter old) =>
      old.t != t ||
      old.level != level ||
      old.color != color ||
      old.speed != speed ||
      old.error != error;
}
