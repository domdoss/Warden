import 'package:shared_preferences/shared_preferences.dart';
import '../config/app_config.dart';
import '../models/server_config.dart';

/// Persists user settings via SharedPreferences.
class SettingsService {
  static const _keyServerUrl = 'server_url';
  static const _keyDefaultJid = 'default_jid';
  static const _keyModel = 'model';
  static const _keySenderName = 'sender_name';

  SharedPreferences? _prefs;

  Future<void> _ensureLoaded() async {
    _prefs ??= await SharedPreferences.getInstance();
  }

  Future<ServerConfig> loadConfig() async {
    await _ensureLoaded();
    return ServerConfig(
      serverUrl: _prefs!.getString(_keyServerUrl) ?? AppConfig.defaultServerUrl,
      defaultJid: _prefs!.getString(_keyDefaultJid) ?? AppConfig.defaultJid,
      model: _prefs!.getString(_keyModel),
      senderName: _prefs!.getString(_keySenderName) ?? AppConfig.defaultSenderName,
    );
  }

  Future<void> saveConfig(ServerConfig config) async {
    await _ensureLoaded();
    await _prefs!.setString(_keyServerUrl, config.serverUrl);
    await _prefs!.setString(_keyDefaultJid, config.defaultJid);
    if (config.model != null) {
      await _prefs!.setString(_keyModel, config.model!);
    } else {
      await _prefs!.remove(_keyModel);
    }
    await _prefs!.setString(_keySenderName, config.senderName);
  }

  Future<String> get serverUrl async {
    await _ensureLoaded();
    return _prefs!.getString(_keyServerUrl) ?? AppConfig.defaultServerUrl;
  }

  Future<String> get defaultJid async {
    await _ensureLoaded();
    return _prefs!.getString(_keyDefaultJid) ?? AppConfig.defaultJid;
  }
}
