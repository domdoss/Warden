import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';

import '../config/app_config.dart';

enum TailscaleState { stopped, connecting, connected, failed }

/// Drives the embedded Tailscale node that ships inside the APK.
///
/// The native side (MainActivity + tsnetproxy.aar) runs a userspace WireGuard
/// node in the app process and listens on 127.0.0.1:<proxyPort>, forwarding to
/// the Warden host on the tailnet. No separate Tailscale app and no system VPN.
class TailscaleService {
  TailscaleService._();

  static final TailscaleService instance = TailscaleService._();

  static const MethodChannel _channel = MethodChannel('warden/tailscale');
  final StreamController<TailscaleState> _ctrl =
      StreamController<TailscaleState>.broadcast();

  TailscaleState _state = TailscaleState.stopped;
  String? _lastError;
  String? _authKeyOverride;
  bool _started = false;
  Timer? _watchdog;

  TailscaleState get state => _state;
  String? get lastError => _lastError;
  bool get isConnected => _state == TailscaleState.connected;

  /// Emits the current state immediately, then every change.
  Stream<TailscaleState> get stateStream async* {
    yield _state;
    yield* _ctrl.stream;
  }

  /// Set a user-supplied auth key (from Settings). Null keeps the baked key.
  void configure({String? authKey}) {
    _authKeyOverride = (authKey != null && authKey.trim().isNotEmpty)
        ? authKey.trim()
        : null;
  }

  void _set(TailscaleState s) {
    _state = s;
    // Never leave the UI spinning forever: if we sit in `connecting` longer
    // than any enrollment should take, fail loudly with a useful next step.
    if (s == TailscaleState.connecting) {
      _watchdog?.cancel();
      _watchdog = Timer(const Duration(seconds: 75), () {
        if (_state == TailscaleState.connecting) {
          _lastError =
              'Timed out connecting. The bundled key may already be used — '
              'tap SIGN IN WITH GOOGLE, or enter a fresh key above.';
          _set(TailscaleState.failed);
        }
      });
    } else {
      _watchdog?.cancel();
      _watchdog = null;
    }
    _ctrl.add(s);
  }

  Future<bool> start() async {
    if (_started && _state == TailscaleState.connected) return true;
    _started = true;
    _set(TailscaleState.connecting);

    try {
      await _channel.invokeMethod<bool>('start', {
        'authKey': _authKeyOverride ?? AppConfig.tailscaleAuthKey,
        'hostname': AppConfig.tailscaleHostname,
        'proxyPort': AppConfig.embeddedProxyPort,
        'peerHost': AppConfig.wardenPeerHost,
        'peerPort': AppConfig.wardenPeerPort,
      }).timeout(const Duration(seconds: 90));
    } on TimeoutException {
      _lastError = 'The embedded node did not respond in time.';
      _set(TailscaleState.failed);
      return false;
    } on PlatformException catch (e) {
      _lastError = e.message ?? e.code;
      _set(TailscaleState.failed);
      return false;
    } on MissingPluginException {
      _lastError = 'embedded tailscale unavailable on this platform';
      _set(TailscaleState.failed);
      return false;
    } catch (e) {
      _lastError = e.toString();
      _set(TailscaleState.failed);
      return false;
    }

    final healthy = await _probeWarden(timeout: const Duration(seconds: 20));
    if (healthy) {
      _lastError = null;
      _set(TailscaleState.connected);
      return true;
    }
    _lastError = await nativeStatus();
    _set(TailscaleState.failed);
    return false;
  }

  Future<void> stop() async {
    _watchdog?.cancel();
    _watchdog = null;
    try {
      await _channel.invokeMethod('stop');
    } catch (_) {}
    _started = false;
    _set(TailscaleState.stopped);
  }

  Future<void> retry() async {
    await stop();
    _lastError = null;
    await start();
  }

  /// Begin interactive sign-in: start the node with no key and return the login
  /// URL. Open it in the browser, then call [finishLogin].
  Future<String?> connectInteractive() async {
    _set(TailscaleState.connecting);
    try {
      final authUrl = await _channel
          .invokeMethod<String>('startInteractive', {
            'hostname': AppConfig.tailscaleHostname,
          })
          .timeout(const Duration(seconds: 20));
      if (authUrl == null || authUrl.isEmpty) {
        _lastError = 'no login URL produced';
        _set(TailscaleState.failed);
        return null;
      }
      return authUrl;
    } on TimeoutException {
      _lastError = 'Timed out starting sign-in.';
      _set(TailscaleState.failed);
      return null;
    } on PlatformException catch (e) {
      _lastError = e.message ?? e.code;
      _set(TailscaleState.failed);
      return null;
    } catch (e) {
      _lastError = e.toString();
      _set(TailscaleState.failed);
      return null;
    }
  }

  /// After the user completes sign-in in the browser, wait for the node to go
  /// running, start the proxy, and mark connected.
  Future<bool> finishLogin() async {
    try {
      await _channel
          .invokeMethod<bool>('waitForLogin', {'timeoutSec': 180})
          .timeout(const Duration(seconds: 195));
    } on TimeoutException {
      _lastError = 'Sign-in did not complete in time.';
      _set(TailscaleState.failed);
      return false;
    } on PlatformException catch (e) {
      _lastError = e.message ?? e.code;
      _set(TailscaleState.failed);
      return false;
    } catch (e) {
      _lastError = e.toString();
      _set(TailscaleState.failed);
      return false;
    }
    try {
      await _channel.invokeMethod<bool>('startProxy', {
        'proxyPort': AppConfig.embeddedProxyPort,
        'peerHost': AppConfig.wardenPeerHost,
        'peerPort': AppConfig.wardenPeerPort,
      }).timeout(const Duration(seconds: 20));
    } on PlatformException catch (e) {
      _lastError = e.message ?? e.code;
      _set(TailscaleState.failed);
      return false;
    } catch (e) {
      _lastError = e.toString();
      _set(TailscaleState.failed);
      return false;
    }
    final healthy = await _probeWarden(timeout: const Duration(seconds: 20));
    if (healthy) {
      _lastError = null;
      _set(TailscaleState.connected);
      return true;
    }
    _lastError = await nativeStatus();
    _set(TailscaleState.failed);
    return false;
  }

  Future<String> nativeStatus() async {
    try {
      return await _channel.invokeMethod<String>('status') ?? 'stopped';
    } catch (_) {
      return 'stopped';
    }
  }

  Future<bool> _probeWarden({required Duration timeout}) async {
    final deadline = DateTime.now().add(timeout);
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 5);
    try {
      while (DateTime.now().isBefore(deadline)) {
        try {
          final req = await client
              .getUrl(Uri.parse('${AppConfig.embeddedServerUrl}/api/health'));
          final resp = await req.close().timeout(const Duration(seconds: 6));
          await resp.drain<void>();
          if (resp.statusCode >= 200 && resp.statusCode < 500) return true;
        } catch (_) {
          // tunnel still warming up
        }
        await Future<void>.delayed(const Duration(milliseconds: 700));
      }
      return false;
    } finally {
      client.close(force: true);
    }
  }
}
