import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config/app_config.dart';
import '../services/api_client.dart';
import '../services/speech_service.dart';
import '../services/tailscale_service.dart';
import '../services/tts_service.dart';

/// User-configurable settings persisted across launches.
class AppSettings {
  final String serverUrl; // custom server override; '' = auto
  final String authKey; // tailscale key override; '' = baked
  final String handle; // BBS handle (profile)

  const AppSettings({
    this.serverUrl = '',
    this.authKey = '',
    this.handle = '',
  });

  AppSettings copyWith({
    String? serverUrl,
    String? authKey,
    String? handle,
  }) =>
      AppSettings(
        serverUrl: serverUrl ?? this.serverUrl,
        authKey: authKey ?? this.authKey,
        handle: handle ?? this.handle,
      );
}

class SettingsNotifier extends AsyncNotifier<AppSettings> {
  static const _kServerUrl = 'server_url';
  static const _kHandle = 'handle';
  static const _kAuthKey = 'ts_authkey';

  @override
  Future<AppSettings> build() async {
    final prefs = await SharedPreferences.getInstance();
    final sec = const FlutterSecureStorage();
    String authKey = '';
    try {
      authKey = await sec.read(key: _kAuthKey) ?? '';
    } catch (_) {}
    return AppSettings(
      serverUrl: prefs.getString(_kServerUrl) ?? '',
      authKey: authKey,
      handle: prefs.getString(_kHandle) ?? '',
    );
  }

  Future<void> setServerUrl(String v) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kServerUrl, v.trim());
    state = AsyncData(state.valueOrNull!.copyWith(serverUrl: v.trim()));
  }

  Future<void> setAuthKey(String v) async {
    const sec = FlutterSecureStorage();
    try {
      if (v.trim().isEmpty) {
        await sec.delete(key: _kAuthKey);
      } else {
        await sec.write(key: _kAuthKey, value: v.trim());
      }
    } catch (_) {}
    state = AsyncData(state.valueOrNull!.copyWith(authKey: v.trim()));
    // Reconfigure the tunnel so a new key takes effect on retry.
    TailscaleService.instance.configure(authKey: v.trim());
  }

  Future<void> setHandle(String v) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kHandle, v.trim());
    state = AsyncData(state.valueOrNull!.copyWith(handle: v.trim()));
  }
}

final settingsProvider =
    AsyncNotifierProvider<SettingsNotifier, AppSettings>(SettingsNotifier.new);

final tailscaleStateProvider =
    StreamProvider<TailscaleState>((ref) => TailscaleService.instance.stateStream);

/// The base URL the app talks to. Embedded tunnel wins; otherwise a custom URL
/// from Settings; otherwise the tailnet HTTPS fallback.
final baseUrlProvider = Provider<String>((ref) {
  final st =
      ref.watch(tailscaleStateProvider).valueOrNull ?? TailscaleState.stopped;
  if (st == TailscaleState.connected) return AppConfig.embeddedServerUrl;
  final s = ref.watch(settingsProvider).valueOrNull;
  if (s != null && s.serverUrl.isNotEmpty) return s.serverUrl;
  return AppConfig.fallbackServerUrl;
});

final apiProvider = Provider<ApiClient>((ref) => ApiClient(ref.watch(baseUrlProvider)));

final speechProvider = Provider<SpeechService>((ref) => SpeechService());
final ttsProvider = Provider<TtsService>((ref) => TtsService());
