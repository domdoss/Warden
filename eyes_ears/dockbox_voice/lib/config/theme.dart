import 'package:flutter/material.dart';

/// Dark theme matching the Jarvis hologram aesthetic.
class AppTheme {
  AppTheme._();

  static const Color cyan = Color(0xFF00FFFF);
  static const Color red = Color(0xFFFF2B2B);
  static const Color orange = Color(0xFFFFAA00);
  static const Color errorRed = Color(0xFFFF0000);
  static const Color background = Color(0xFF000000);
  static const Color surface = Color(0xFF0A0A0A);

  static ThemeData get darkTheme {
    return ThemeData(
      brightness: Brightness.dark,
      scaffoldBackgroundColor: background,
      colorScheme: const ColorScheme.dark(
        primary: cyan,
        secondary: cyan,
        surface: surface,
        error: errorRed,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: surface,
        foregroundColor: cyan,
        elevation: 0,
      ),
      textTheme: const TextTheme(
        bodyLarge: TextStyle(color: cyan, fontFamily: 'monospace'),
        bodyMedium: TextStyle(color: cyan, fontFamily: 'monospace'),
      ),
      inputDecorationTheme: InputDecorationTheme(
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: cyan),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: cyan, width: 0.5),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: cyan, width: 2),
        ),
        labelStyle: const TextStyle(color: cyan),
        hintStyle: TextStyle(color: cyan.withValues(alpha: 0.4)),
      ),
    );
  }
}
