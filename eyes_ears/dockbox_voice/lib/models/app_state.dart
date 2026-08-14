/// Application UI state enum — mirrors the Python app's state machine.
enum AppState {
  idle,
  listening,
  processing,
  speaking,
  error,
}
