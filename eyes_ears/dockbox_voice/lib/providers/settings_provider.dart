import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/server_config.dart';
import '../services/settings_service.dart';

/// Singleton settings service.
final settingsServiceProvider = Provider<SettingsService>((ref) {
  return SettingsService();
});

/// Loaded server configuration.
final serverConfigProvider = FutureProvider<ServerConfig>((ref) async {
  final service = ref.watch(settingsServiceProvider);
  return service.loadConfig();
});

/// Notifier for updating settings at runtime.
final settingsNotifierProvider =
    AsyncNotifierProvider<SettingsNotifier, ServerConfig>(
  SettingsNotifier.new,
);

class SettingsNotifier extends AsyncNotifier<ServerConfig> {
  @override
  Future<ServerConfig> build() async {
    final service = ref.read(settingsServiceProvider);
    return service.loadConfig();
  }

  Future<void> updateConfig(ServerConfig config) async {
    final service = ref.read(settingsServiceProvider);
    await service.saveConfig(config);
    state = AsyncData(config);
  }
}
