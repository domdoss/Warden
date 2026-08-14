// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'conversation_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
  'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models',
);

/// @nodoc
mixin _$ConversationState {
  AppState get appState => throw _privateConstructorUsedError;
  bool get conversationActive => throw _privateConstructorUsedError;
  String? get transcribedText => throw _privateConstructorUsedError;
  String? get responseText => throw _privateConstructorUsedError;
  double get audioLevel => throw _privateConstructorUsedError;
  String? get errorMessage => throw _privateConstructorUsedError;

  /// Create a copy of ConversationState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $ConversationStateCopyWith<ConversationState> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $ConversationStateCopyWith<$Res> {
  factory $ConversationStateCopyWith(
    ConversationState value,
    $Res Function(ConversationState) then,
  ) = _$ConversationStateCopyWithImpl<$Res, ConversationState>;
  @useResult
  $Res call({
    AppState appState,
    bool conversationActive,
    String? transcribedText,
    String? responseText,
    double audioLevel,
    String? errorMessage,
  });
}

/// @nodoc
class _$ConversationStateCopyWithImpl<$Res, $Val extends ConversationState>
    implements $ConversationStateCopyWith<$Res> {
  _$ConversationStateCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of ConversationState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? appState = null,
    Object? conversationActive = null,
    Object? transcribedText = freezed,
    Object? responseText = freezed,
    Object? audioLevel = null,
    Object? errorMessage = freezed,
  }) {
    return _then(
      _value.copyWith(
            appState: null == appState
                ? _value.appState
                : appState // ignore: cast_nullable_to_non_nullable
                      as AppState,
            conversationActive: null == conversationActive
                ? _value.conversationActive
                : conversationActive // ignore: cast_nullable_to_non_nullable
                      as bool,
            transcribedText: freezed == transcribedText
                ? _value.transcribedText
                : transcribedText // ignore: cast_nullable_to_non_nullable
                      as String?,
            responseText: freezed == responseText
                ? _value.responseText
                : responseText // ignore: cast_nullable_to_non_nullable
                      as String?,
            audioLevel: null == audioLevel
                ? _value.audioLevel
                : audioLevel // ignore: cast_nullable_to_non_nullable
                      as double,
            errorMessage: freezed == errorMessage
                ? _value.errorMessage
                : errorMessage // ignore: cast_nullable_to_non_nullable
                      as String?,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$ConversationStateImplCopyWith<$Res>
    implements $ConversationStateCopyWith<$Res> {
  factory _$$ConversationStateImplCopyWith(
    _$ConversationStateImpl value,
    $Res Function(_$ConversationStateImpl) then,
  ) = __$$ConversationStateImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    AppState appState,
    bool conversationActive,
    String? transcribedText,
    String? responseText,
    double audioLevel,
    String? errorMessage,
  });
}

/// @nodoc
class __$$ConversationStateImplCopyWithImpl<$Res>
    extends _$ConversationStateCopyWithImpl<$Res, _$ConversationStateImpl>
    implements _$$ConversationStateImplCopyWith<$Res> {
  __$$ConversationStateImplCopyWithImpl(
    _$ConversationStateImpl _value,
    $Res Function(_$ConversationStateImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of ConversationState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? appState = null,
    Object? conversationActive = null,
    Object? transcribedText = freezed,
    Object? responseText = freezed,
    Object? audioLevel = null,
    Object? errorMessage = freezed,
  }) {
    return _then(
      _$ConversationStateImpl(
        appState: null == appState
            ? _value.appState
            : appState // ignore: cast_nullable_to_non_nullable
                  as AppState,
        conversationActive: null == conversationActive
            ? _value.conversationActive
            : conversationActive // ignore: cast_nullable_to_non_nullable
                  as bool,
        transcribedText: freezed == transcribedText
            ? _value.transcribedText
            : transcribedText // ignore: cast_nullable_to_non_nullable
                  as String?,
        responseText: freezed == responseText
            ? _value.responseText
            : responseText // ignore: cast_nullable_to_non_nullable
                  as String?,
        audioLevel: null == audioLevel
            ? _value.audioLevel
            : audioLevel // ignore: cast_nullable_to_non_nullable
                  as double,
        errorMessage: freezed == errorMessage
            ? _value.errorMessage
            : errorMessage // ignore: cast_nullable_to_non_nullable
                  as String?,
      ),
    );
  }
}

/// @nodoc

class _$ConversationStateImpl extends _ConversationState {
  const _$ConversationStateImpl({
    this.appState = AppState.idle,
    this.conversationActive = false,
    this.transcribedText,
    this.responseText,
    this.audioLevel = 0.0,
    this.errorMessage,
  }) : super._();

  @override
  @JsonKey()
  final AppState appState;
  @override
  @JsonKey()
  final bool conversationActive;
  @override
  final String? transcribedText;
  @override
  final String? responseText;
  @override
  @JsonKey()
  final double audioLevel;
  @override
  final String? errorMessage;

  @override
  String toString() {
    return 'ConversationState(appState: $appState, conversationActive: $conversationActive, transcribedText: $transcribedText, responseText: $responseText, audioLevel: $audioLevel, errorMessage: $errorMessage)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$ConversationStateImpl &&
            (identical(other.appState, appState) ||
                other.appState == appState) &&
            (identical(other.conversationActive, conversationActive) ||
                other.conversationActive == conversationActive) &&
            (identical(other.transcribedText, transcribedText) ||
                other.transcribedText == transcribedText) &&
            (identical(other.responseText, responseText) ||
                other.responseText == responseText) &&
            (identical(other.audioLevel, audioLevel) ||
                other.audioLevel == audioLevel) &&
            (identical(other.errorMessage, errorMessage) ||
                other.errorMessage == errorMessage));
  }

  @override
  int get hashCode => Object.hash(
    runtimeType,
    appState,
    conversationActive,
    transcribedText,
    responseText,
    audioLevel,
    errorMessage,
  );

  /// Create a copy of ConversationState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$ConversationStateImplCopyWith<_$ConversationStateImpl> get copyWith =>
      __$$ConversationStateImplCopyWithImpl<_$ConversationStateImpl>(
        this,
        _$identity,
      );
}

abstract class _ConversationState extends ConversationState {
  const factory _ConversationState({
    final AppState appState,
    final bool conversationActive,
    final String? transcribedText,
    final String? responseText,
    final double audioLevel,
    final String? errorMessage,
  }) = _$ConversationStateImpl;
  const _ConversationState._() : super._();

  @override
  AppState get appState;
  @override
  bool get conversationActive;
  @override
  String? get transcribedText;
  @override
  String? get responseText;
  @override
  double get audioLevel;
  @override
  String? get errorMessage;

  /// Create a copy of ConversationState
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$ConversationStateImplCopyWith<_$ConversationStateImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
