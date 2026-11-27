import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../config/app_config.dart';

/// Drives the embedded Tailscale node that ships inside the APK.
///
/// The native side (MainActivity + tsnetproxy.aar) runs a userspace WireGuard
/// node in the app process and listens on `127.0.0.1:<embeddedProxyPort>`,
/// forwarding to the Warden host on the tailnet. No separate Tailscale app and
/// no system VPN are involved.
///
/// [baseUrl] becomes non-null once the tunnel is confirmed healthy; the API
/// provider watches [baseUrlStream] and switches to it automatically. If the
/// tunnel cannot come up, the app keeps using [AppConfig.defaultServerUrl]
/// (the tailnet HTTPS address), which still works on a phone that has the
/// Tailscale app installed.
class TailscaleService {
  TailscaleService._();

  static const MethodChannel _channel = MethodChannel('warden/tailscale');
  static final StreamController<String?> _baseUrlCtrl =
      StreamController<String?>.broadcast();

  static String? _baseUrl;
  static String? _lastError;
  static bool _started = false;

  /// The localhost URL of the embedded tunnel, or null if it is not up yet.
  static String? get baseUrl => _baseUrl;

  /// Last native-side failure, for the settings/diagnostics UI.
  static String? get lastError => _lastError;

  /// Emits the current base URL immediately, then every change.
  static Stream<String?> get baseUrlStream async* {
    yield _baseUrl;
    yield* _baseUrlCtrl.stream;
  }

  /// Starts the node, then waits until the tunnel actually carries Warden
  /// traffic. Safe to call more than once.
  static Future<bool> start() async {
    if (_started) return _baseUrl != null;
    _started = true;

    try {
      await _channel.invokeMethod<bool>('start', {
        'authKey': AppConfig.tailscaleAuthKey,
        'hostname': AppConfig.tailscaleHostname,
        'proxyPort': AppConfig.embeddedProxyPort,
        'peerHost': AppConfig.wardenPeerIp,
        'peerPort': AppConfig.wardenPeerPort,
      });
    } on PlatformException catch (e) {
      _lastError = e.message ?? e.code;
      debugPrint('tailscale: start failed: $_lastError');
      return false;
    } on MissingPluginException {
      // Non-Android build (or the AAR was stripped) — fall back to the URL.
      _lastError = 'embedded tailscale unavailable on this platform';
      return false;
    } catch (e) {
      _lastError = e.toString();
      debugPrint('tailscale: start failed: $_lastError');
      return false;
    }

    // The node reports "connected" before the proxy is serving, and the first
    // request over a fresh tunnel can be slow while paths are established.
    final healthy = await _waitForWarden(
      timeout: const Duration(seconds: 45),
    );
    if (healthy) {
      _lastError = null;
      _setBaseUrl(AppConfig.embeddedServerUrl);
      debugPrint('tailscale: tunnel up at ${AppConfig.embeddedServerUrl}');
      return true;
    }

    _lastError = await _nativeStatus();
    debugPrint('tailscale: tunnel did not answer: $_lastError');
    return false;
  }

  static Future<void> stop() async {
    try {
      await _channel.invokeMethod('stop');
    } catch (_) {}
    _started = false;
    _setBaseUrl(null);
  }

  /// Clears the previous attempt and brings the tunnel up again.
  static Future<bool> retry() async {
    await stop();
    _lastError = null;
    return start();
  }

  static void _setBaseUrl(String? url) {
    if (_baseUrl == url) return;
    _baseUrl = url;
    _baseUrlCtrl.add(url);
  }

  static Future<String?> _nativeStatus() async {
    try {
      return await _channel.invokeMethod<String>('status');
    } catch (_) {
      return null;
    }
  }

  /// Polls Warden over the tunnel until it answers, or the timeout expires.
  static Future<bool> _waitForWarden({required Duration timeout}) async {
    final deadline = DateTime.now().add(timeout);
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 5)
      ..idleTimeout = const Duration(seconds: 2);
    try {
      while (DateTime.now().isBefore(deadline)) {
        try {
          final req = await client.getUrl(
            Uri.parse('${AppConfig.embeddedServerUrl}${AppConfig.embeddedHealthPath}'),
          );
          final resp = await req.close().timeout(const Duration(seconds: 6));
          await resp.drain<void>();
          if (resp.statusCode >= 200 && resp.statusCode < 500) return true;
        } catch (_) {
          // Tunnel still warming up — retry.
        }
        await Future<void>.delayed(const Duration(milliseconds: 700));
      }
      return false;
    } finally {
      client.close(force: true);
    }
  }
}
