/// Server configuration model.
class ServerConfig {
  final String serverUrl;
  final String defaultJid;
  final String? model;
  final String senderName;

  const ServerConfig({
    required this.serverUrl,
    required this.defaultJid,
    this.model,
    this.senderName = 'Jarvis',
  });

  ServerConfig copyWith({
    String? serverUrl,
    String? defaultJid,
    String? model,
    String? senderName,
  }) {
    return ServerConfig(
      serverUrl: serverUrl ?? this.serverUrl,
      defaultJid: defaultJid ?? this.defaultJid,
      model: model ?? this.model,
      senderName: senderName ?? this.senderName,
    );
  }
}
