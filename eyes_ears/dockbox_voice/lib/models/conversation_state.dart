import 'package:freezed_annotation/freezed_annotation.dart';
import 'app_state.dart';

part 'conversation_state.freezed.dart';

/// Full conversation state tracked by [ConversationNotifier].
@freezed
class ConversationState with _$ConversationState {
  const factory ConversationState({
    @Default(AppState.idle) AppState appState,
    @Default(false) bool conversationActive,
    String? transcribedText,
    String? responseText,
    @Default(0.0) double audioLevel,
    String? errorMessage,
  }) = _ConversationState;

  const ConversationState._();
}
