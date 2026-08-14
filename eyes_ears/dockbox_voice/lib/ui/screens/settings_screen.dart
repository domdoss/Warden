import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../config/app_config.dart';
import '../../config/theme.dart';
import '../../models/server_config.dart';
import '../../providers/settings_provider.dart';

/// Settings screen for configuring the Dockbox server connection.
class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  final _serverUrlController = TextEditingController();
  final _jidController = TextEditingController();
  final _modelController = TextEditingController();
  final _senderNameController = TextEditingController();
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadConfig();
  }

  Future<void> _loadConfig() async {
    final config = ref.read(serverConfigProvider).valueOrNull;
    if (config != null) {
      _serverUrlController.text = config.serverUrl;
      _jidController.text = config.defaultJid;
      _modelController.text = config.model ?? '';
      _senderNameController.text = config.senderName;
    }
    setState(() => _loading = false);
  }

  Future<void> _save() async {
    final config = ServerConfig(
      serverUrl: _serverUrlController.text.trim(),
      defaultJid: _jidController.text.trim(),
      model: _modelController.text.trim().isEmpty
          ? null
          : _modelController.text.trim(),
      senderName: _senderNameController.text.trim().isEmpty
          ? AppConfig.defaultSenderName
          : _senderNameController.text.trim(),
    );

    await ref.read(settingsNotifierProvider.notifier).updateConfig(config);

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Settings saved')),
      );
      Navigator.of(context).pop();
    }
  }

  @override
  void dispose() {
    _serverUrlController.dispose();
    _jidController.dispose();
    _modelController.dispose();
    _senderNameController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator(color: AppTheme.cyan)),
      );
    }

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: const Text('Settings'),
        centerTitle: true,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _buildField(
              label: 'Server URL',
              controller: _serverUrlController,
              hint: AppConfig.defaultServerUrl,
              keyboardType: TextInputType.url,
            ),
            const SizedBox(height: 20),
            _buildField(
              label: 'Default JID',
              controller: _jidController,
              hint: AppConfig.defaultJid,
            ),
            const SizedBox(height: 20),
            _buildField(
              label: 'Model (optional)',
              controller: _modelController,
              hint: 'e.g. local:gemma4:latest',
            ),
            const SizedBox(height: 20),
            _buildField(
              label: 'Sender Name',
              controller: _senderNameController,
              hint: AppConfig.defaultSenderName,
            ),
            const SizedBox(height: 40),
            ElevatedButton(
              onPressed: _save,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.cyan,
                foregroundColor: AppTheme.background,
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              child: const Text(
                'SAVE',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 2,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildField({
    required String label,
    required TextEditingController controller,
    required String hint,
    TextInputType keyboardType = TextInputType.text,
  }) {
    return TextField(
      controller: controller,
      keyboardType: keyboardType,
      style: const TextStyle(color: AppTheme.cyan, fontFamily: 'monospace'),
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        labelStyle: const TextStyle(color: AppTheme.cyan),
        hintStyle: TextStyle(color: AppTheme.cyan.withValues(alpha: 0.3)),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: BorderSide(color: AppTheme.cyan.withValues(alpha: 0.3)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: AppTheme.cyan, width: 2),
        ),
      ),
    );
  }
}
