import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme.dart';

/// The Horned Warden — the machine-knight mascot. One sprite per emotional
/// state, from the Chibi Warden Knight sticker sheet.
enum MascotPose {
  idle, // 01 stand, sword + shield
  sent, // 02 sword raised overhead
  charging, // 03 cape flying, on the move
  done, // 04 arms up, victory
  guide, // 05 pointing — "this way"
  search, // 06 lantern — looking into it
  scroll, // 07 reading a scroll / plans
  quiet, // 08 shush — private, local
  watch, // 09 peeking over rock — keeping watch
  rest, // 10 meditating — standby
  alert, // 11 battle stance — needs you
  camp, // 12 campfire — all clear / offline
}

String mascotAsset(MascotPose p) {
  const names = {
    MascotPose.idle: 'pose_01',
    MascotPose.sent: 'pose_02',
    MascotPose.charging: 'pose_03',
    MascotPose.done: 'pose_04',
    MascotPose.guide: 'pose_05',
    MascotPose.search: 'pose_06',
    MascotPose.scroll: 'pose_07',
    MascotPose.quiet: 'pose_08',
    MascotPose.watch: 'pose_09',
    MascotPose.rest: 'pose_10',
    MascotPose.alert: 'pose_11',
    MascotPose.camp: 'pose_12',
  };
  return 'assets/mascot/${names[p]}.png';
}

/// Derive the Warden's pose from chat/connection state.
MascotPose poseForChat({
  bool listening = false,
  bool sending = false,
  bool streaming = false,
  bool error = false,
}) {
  if (error) return MascotPose.alert;
  if (listening) return MascotPose.guide;
  if (sending) return MascotPose.sent;
  if (streaming) return MascotPose.charging;
  return MascotPose.idle;
}

/// A circular sprite of the Warden with an ember glow ring and a gentle
/// breathing animation.
class WardenMascot extends StatefulWidget {
  final MascotPose pose;
  final double size;
  const WardenMascot({super.key, required this.pose, this.size = 96});

  @override
  State<WardenMascot> createState() => _WardenMascotState();
}

class _WardenMascotState extends State<WardenMascot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 3),
  )..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.size;
    return SizedBox(
      width: s,
      height: s,
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, _) {
          final breathe = 1.0 + 0.015 * math.sin(_c.value * 2 * math.pi);
          return Stack(
            alignment: Alignment.center,
            children: [
              // violet glow
              Container(
                width: s * 1.06,
                height: s * 1.06,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(
                      color: WardenColors.crimson.withValues(alpha: 0.4),
                      blurRadius: s * 0.35,
                      spreadRadius: 2,
                    ),
                  ],
                ),
              ),
              // dark disc so the sprite never shows a fringe
              Container(
                width: s,
                height: s,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  color: WardenColors.background,
                ),
              ),
              Transform.scale(
                scale: breathe,
                child: ClipOval(
                  child: Image.asset(
                    mascotAsset(widget.pose),
                    width: s,
                    height: s,
                    fit: BoxFit.cover,
                  ),
                ),
              ),
              // cyan rim
              Container(
                width: s,
                height: s,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(
                      color: WardenColors.cyan.withValues(alpha: 0.5),
                      width: 1.5),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
