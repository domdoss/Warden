import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../config/app_config.dart';
import '../../providers/providers.dart';
import '../../services/tailscale_service.dart';
import '../../theme.dart';
import '../widgets/settings_cards.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  final _serverUrl = TextEditingController();
  final _authKey = TextEditingController();
  final _handle = TextEditingController();
  bool _loaded = false;

  @override
  void dispose() {
    _serverUrl.dispose();
    _authKey.dispose();
    _handle.dispose();
    super.dispose();
  }

  void _load(AppSettings s) {
    if (_loaded) return;
    _loaded = true;
    _serverUrl.text = s.serverUrl;
    _authKey.text = s.authKey;
    _handle.text = s.handle;
  }

  @override
  Widget build(BuildContext context) {
    final settings = ref.watch(settingsProvider).valueOrNull;
    if (settings != null) _load(settings);

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: SafeArea(
        top: false,
        child: ListView(
          padding: EdgeInsets.fromLTRB(
            16,
            16,
            16,
            24 + MediaQuery.of(context).viewPadding.bottom,
          ),
          children: [
            _TailscaleCard(),
            const ModelsCard(),
            const TrainingCard(),
            const SizedBox(height: 16),
            _Field(
              label: 'Server URL (override)',
              hint: 'empty = auto (embedded tunnel, then tailnet)',
              controller: _serverUrl,
            ),
            const SizedBox(height: 16),
            _Field(
              label: 'Tailscale auth key (override)',
              hint: 'empty = use the key baked into the APK',
              controller: _authKey,
              obscure: true,
            ),
            const SizedBox(height: 16),
            _Field(
              label: 'BBS handle',
              hint: 'your caller handle',
              controller: _handle,
            ),
            const SizedBox(height: 24),
            FilledButton(
              style: FilledButton.styleFrom(
                  backgroundColor: WardenColors.cyan,
                  foregroundColor: WardenColors.background,
                  padding: const EdgeInsets.symmetric(vertical: 16)),
              onPressed: () async {
                final n = ref.read(settingsProvider.notifier);
                await n.setServerUrl(_serverUrl.text);
                await n.setAuthKey(_authKey.text);
                await n.setHandle(_handle.text);
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Saved')));
                }
              },
              child: const Text('SAVE'),
            ),
          ],
        ),
      ),
    );
  }
}

class _TailscaleCard extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final st =
        ref.watch(tailscaleStateProvider).valueOrNull ?? TailscaleState.stopped;
    final err = TailscaleService.instance.lastError;

    final (color, label) = switch (st) {
      TailscaleState.connected => (WardenColors.green, 'Connected'),
      TailscaleState.connecting => (WardenColors.amber, 'Connecting…'),
      TailscaleState.failed => (WardenColors.red, 'Failed'),
      TailscaleState.stopped => (WardenColors.textDim, 'Stopped'),
    };

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: WardenColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('TAILSCALE TUNNEL (BUILT IN)',
              style: TextStyle(
                  color: WardenColors.textDim,
                  fontSize: 11,
                  letterSpacing: 2)),
          const SizedBox(height: 10),
          Row(
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(color: color, shape: BoxShape.circle),
              ),
              const SizedBox(width: 10),
              Text(label,
                  style: TextStyle(
                      color: color,
                      fontSize: 15,
                      fontWeight: FontWeight.w600)),
              const Spacer(),
              if (st == TailscaleState.connecting)
                const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: WardenColors.amber)),
            ],
          ),
          if (err != null && st == TailscaleState.failed) ...[
            const SizedBox(height: 8),
            Text(err,
                style: const TextStyle(
                    color: WardenColors.red, fontSize: 12)),
          ],
          const SizedBox(height: 6),
          const Text(
            'Runs a userspace Tailscale node inside the app — no separate Tailscale app, no VPN prompt. Node: ${AppConfig.tailscaleHostname}',
            style: TextStyle(color: WardenColors.textDim, fontSize: 11),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 4,
            children: [
              if (st == TailscaleState.connected || st == TailscaleState.connecting)
                TextButton(
                  onPressed: () => TailscaleService.instance.stop(),
                  child: const Text('DISCONNECT',
                      style: TextStyle(color: WardenColors.red)),
                )
              else ...[
                TextButton(
                  onPressed: () => TailscaleService.instance.start(),
                  child: const Text('RECONNECT',
                      style: TextStyle(color: WardenColors.cyan)),
                ),
                TextButton(
                  onPressed: () => _signInWithGoogle(context),
                  child: const Text('SIGN IN WITH GOOGLE',
                      style: TextStyle(color: WardenColors.crimson)),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _signInWithGoogle(BuildContext context) async {
    final url = await TailscaleService.instance.connectInteractive();
    if (!context.mounted) return;
    if (url == null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(
              'Failed to start login: ${TailscaleService.instance.lastError}')));
      return;
    }
    final opened = await launchUrl(Uri.parse(url),
        mode: LaunchMode.externalApplication);
    if (!context.mounted) return;
    if (!opened) {
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Open this link in your browser:\n$url')));
      return;
    }
    final ok = await TailscaleService.instance.finishLogin();
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(ok
            ? 'Connected!'
            : 'Login failed: ${TailscaleService.instance.lastError}')));
  }
}

class _Field extends StatelessWidget {
  final String label;
  final String hint;
  final TextEditingController controller;
  final bool obscure;
  const _Field({
    required this.label,
    required this.hint,
    required this.controller,
    this.obscure = false,
  });

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      obscureText: obscure,
      style: const TextStyle(color: WardenColors.text),
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        labelStyle: const TextStyle(color: WardenColors.textDim),
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
}
