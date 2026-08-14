import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/theme.dart';
import '../models/app_state.dart';
import 'conversation_provider.dart';

/// UI state for the hologram widget.
class HologramState {
  final AppState appState;
  final double audioLevel;
  final Color targetColor;
  final double coreSpeed;
  final double particleDrift;
  final double ringSpeed;
  final double pulseAmp;
  final bool flash;

  const HologramState({
    required this.appState,
    required this.audioLevel,
    required this.targetColor,
    required this.coreSpeed,
    required this.particleDrift,
    required this.ringSpeed,
    required this.pulseAmp,
    required this.flash,
  });
}

/// State-to-visual parameters, ported from jarvis.html STATE_PARAMS.
class _StateParams {
  final Color color;
  final double coreSpeed;
  final double particleDrift;
  final double ringSpeed;
  final double pulseAmp;
  final bool flash;

  const _StateParams({
    required this.color,
    required this.coreSpeed,
    required this.particleDrift,
    required this.ringSpeed,
    required this.pulseAmp,
    required this.flash,
  });
}

const _params = {
  AppState.idle: _StateParams(
    color: AppTheme.cyan,
    coreSpeed: 0.001,
    particleDrift: 1.0,
    ringSpeed: 1.0,
    pulseAmp: 0.10,
    flash: false,
  ),
  AppState.listening: _StateParams(
    color: AppTheme.red,
    coreSpeed: 0.0088,
    particleDrift: 1.8,
    ringSpeed: 1.2,
    pulseAmp: 0.18,
    flash: false,
  ),
  AppState.processing: _StateParams(
    color: AppTheme.orange,
    coreSpeed: 0.0035,
    particleDrift: 3.8,
    ringSpeed: 2.6,
    pulseAmp: 0.14,
    flash: false,
  ),
  AppState.speaking: _StateParams(
    color: AppTheme.cyan,
    coreSpeed: 0.002,
    particleDrift: 1.3,
    ringSpeed: 1.3,
    pulseAmp: 0.10,
    flash: false,
  ),
  AppState.error: _StateParams(
    color: AppTheme.errorRed,
    coreSpeed: 0.003,
    particleDrift: 1.0,
    ringSpeed: 1.0,
    pulseAmp: 0.12,
    flash: true,
  ),
};

/// Derived hologram state from the conversation state.
final hologramStateProvider = Provider<HologramState>((ref) {
  final conv = ref.watch(conversationProvider);
  final appState = conv.valueOrNull?.appState ?? AppState.idle;
  final audioLevel = conv.valueOrNull?.audioLevel ?? 0.0;
  final p = _params[appState]!;

  return HologramState(
    appState: appState,
    audioLevel: audioLevel,
    targetColor: p.color,
    coreSpeed: p.coreSpeed,
    particleDrift: p.particleDrift,
    ringSpeed: p.ringSpeed,
    pulseAmp: p.pulseAmp,
    flash: p.flash,
  );
});
