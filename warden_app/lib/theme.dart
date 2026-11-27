import 'package:flutter/material.dart';

/// Warden palette — dark, crimson, glassy. Futuristic and clean.
class WardenColors {
  WardenColors._();

  static const background = Color(0xFF0B0406);
  static const surface = Color(0xFF160A0E);
  static const surfaceAlt = Color(0xFF221016);
  static const crimson = Color(0xFFFF2E4D); // primary red accent
  static const cyan = Color(0xFF00E5FF); // the cool glow accent
  static const green = Color(0xFF00FF88);
  static const amber = Color(0xFFFFAA00);
  static const red = Color(0xFFFF5C6B); // error / destructive
  static const text = Color(0xFFFFF1F1);
  static const textDim = Color(0xFFC09AA0);
  static const border = Color(0xFF3A1820);
}

ThemeData wardenTheme() {
  final base = ThemeData.dark(useMaterial3: true);
  return base.copyWith(
    scaffoldBackgroundColor: WardenColors.background,
    colorScheme: const ColorScheme.dark(
      primary: WardenColors.crimson,
      secondary: WardenColors.cyan,
      surface: WardenColors.surface,
      error: WardenColors.red,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: WardenColors.background,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      iconTheme: IconThemeData(color: WardenColors.text),
      titleTextStyle: TextStyle(
        color: WardenColors.text,
        fontSize: 18,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.5,
      ),
    ),
    dividerColor: WardenColors.border,
    drawerTheme: const DrawerThemeData(
      backgroundColor: WardenColors.surface,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: WardenColors.surface,
      indicatorColor: WardenColors.crimson.withValues(alpha: 0.28),
      iconTheme: WidgetStateProperty.resolveWith(
        (states) => IconThemeData(
          color: states.contains(WidgetState.selected)
              ? WardenColors.crimson
              : WardenColors.textDim,
        ),
      ),
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => TextStyle(
          fontSize: 11,
          color: states.contains(WidgetState.selected)
              ? WardenColors.crimson
              : WardenColors.textDim,
        ),
      ),
    ),
    textTheme: base.textTheme.apply(
      bodyColor: WardenColors.text,
      displayColor: WardenColors.text,
    ),
  );
}
