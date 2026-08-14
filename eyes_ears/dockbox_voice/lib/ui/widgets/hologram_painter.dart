import 'dart:math';

import 'package:flutter/material.dart';

import '../../config/theme.dart';
import '../../providers/hologram_provider.dart';

/// CustomPainter that renders a 2D hologram with particles, rings, and a
/// pulsing core. Ported from the Three.js animation in jarvis.html.
class HologramPainter extends CustomPainter {
  final HologramState state;
  final double time;
  final Size size;

  // Current color (lerped toward target each frame)
  Color _currentColor = AppTheme.cyan;

  // Particles
  final List<_Particle> _particles = [];
  bool _particlesInitialized = false;

  HologramPainter({
    required this.state,
    required this.time,
    required this.size,
  }) {
    if (!_particlesInitialized) {
      _initParticles();
      _particlesInitialized = true;
    }
  }

  void _initParticles() {
    final rng = Random(42);
    for (int i = 0; i < 200; i++) {
      final angle = rng.nextDouble() * 2 * pi;
      final radius = rng.nextDouble() * 0.4;
      _particles.add(_Particle(
        x: cos(angle) * radius,
        y: sin(angle) * radius,
        origX: cos(angle) * radius,
        origY: sin(angle) * radius,
        vx: (rng.nextDouble() - 0.5) * 0.002,
        vy: (rng.nextDouble() - 0.5) * 0.002,
        size: rng.nextDouble() * 2.0 + 0.5,
      ));
    }
  }

  @override
  void paint(Canvas canvas, Size size) {
    final cx = size.width / 2;
    final cy = size.height / 2;
    final baseRadius = min(cx, cy) * 0.35;

    // Lerp color toward target
    _currentColor = Color.lerp(
      _currentColor,
      state.targetColor,
      0.1,
    )!;

    final paint = Paint()..style = PaintingStyle.fill;
    final strokePaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;

    // ---- Core sphere ----
    final pulse = sin(time * state.coreSpeed) * state.pulseAmp;
    final audioBoost = state.audioLevel * 0.15;
    final coreRadius = baseRadius * (0.3 + pulse + audioBoost);

    // Outer glow
    paint.color = _currentColor.withValues(alpha: 0.08);
    canvas.drawCircle(Offset(cx, cy), coreRadius * 1.6, paint);

    // Main core
    paint.color = _currentColor.withValues(alpha: 0.25);
    canvas.drawCircle(Offset(cx, cy), coreRadius, paint);

    // Inner bright spot
    paint.color = _currentColor.withValues(alpha: 0.5 + state.audioLevel * 0.2);
    canvas.drawCircle(Offset(cx, cy), coreRadius * 0.5, paint);

    // ---- Wireframe sphere ----
    strokePaint.color = _currentColor.withValues(alpha: 0.4);
    canvas.drawCircle(Offset(cx, cy), coreRadius * 1.15, strokePaint);

    // ---- Particles ----
    for (final p in _particles) {
      // Drift particles
      p.x += p.vx * state.particleDrift;
      p.y += p.vy * state.particleDrift;

      // Pull back toward original position
      p.x += (p.origX - p.x) * 0.01;
      p.y += (p.origY - p.y) * 0.01;

      // Audio push
      if (state.audioLevel > 0.01) {
        final dist = sqrt(p.x * p.x + p.y * p.y);
        if (dist > 0.001) {
          p.x += (p.x / dist) * state.audioLevel * 0.01;
          p.y += (p.y / dist) * state.audioLevel * 0.01;
        }
      }

      final px = cx + p.x * baseRadius * 2;
      final py = cy + p.y * baseRadius * 2;

      paint.color = _currentColor.withValues(alpha: 0.6);
      canvas.drawCircle(Offset(px, py), p.size, paint);
    }

    // ---- Concentric rings ----
    for (int i = 0; i < 3; i++) {
      final ringRadius = baseRadius * (0.5 + i * 0.25);
      final rotation = time * state.ringSpeed * (i.isEven ? 0.001 : -0.0007);
      final alpha = (0.3 - i * 0.08).clamp(0.05, 1.0);

      strokePaint.color = _currentColor.withValues(alpha: alpha);
      _drawRotatedRing(canvas, cx, cy, ringRadius, rotation, strokePaint);
    }

    // ---- Orbital rings (ellipses at angles) ----
    for (int i = 0; i < 2; i++) {
      final angle = i * pi / 3 + time * 0.0003;
      final ringRadius = baseRadius * (0.7 + i * 0.2);
      final alpha = 0.15 - i * 0.05;

      strokePaint.color = _currentColor.withValues(alpha: alpha.clamp(0.03, 1.0));
      _drawOrbitalRing(canvas, cx, cy, ringRadius, ringRadius * 0.4, angle, strokePaint);
    }

    // ---- Energy field wireframe ----
    final sides = 6;
    final fieldRadius = baseRadius * 0.9;
    final fieldRotation = time * 0.0004;
    final path = Path();
    for (int i = 0; i < sides; i++) {
      final a = (i / sides) * 2 * pi + fieldRotation;
      final x = cx + cos(a) * fieldRadius;
      final y = cy + sin(a) * fieldRadius;
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    path.close();
    strokePaint.color = _currentColor.withValues(alpha: 0.15);
    canvas.drawPath(path, strokePaint);

    // ---- Error flash ----
    if (state.flash) {
      final flashAlpha = (sin(time * 0.02) * 0.5 + 0.5) * 0.3;
      paint.color = state.targetColor.withValues(alpha: flashAlpha);
      canvas.drawRect(
        Rect.fromLTWH(0, 0, size.width, size.height),
        paint,
      );
    }
  }

  void _drawRotatedRing(
    Canvas canvas,
    double cx,
    double cy,
    double radius,
    double rotation,
    Paint paint,
  ) {
    final segments = 60;
    final path = Path();
    for (int i = 0; i < segments; i++) {
      final a = (i / segments) * 2 * pi + rotation;
      final x = cx + cos(a) * radius;
      final y = cy + sin(a) * radius;
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    path.close();
    canvas.drawPath(path, paint);
  }

  void _drawOrbitalRing(
    Canvas canvas,
    double cx,
    double cy,
    double rx,
    double ry,
    double angle,
    Paint paint,
  ) {
    canvas.save();
    canvas.translate(cx, cy);
    canvas.rotate(angle);
    canvas.drawOval(Rect.fromCenter(center: Offset.zero, width: rx * 2, height: ry * 2), paint);
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant HologramPainter oldDelegate) => true;
}

class _Particle {
  double x, y;
  final double origX, origY;
  final double vx, vy;
  final double size;

  _Particle({
    required this.x,
    required this.y,
    required this.origX,
    required this.origY,
    required this.vx,
    required this.vy,
    required this.size,
  });
}
