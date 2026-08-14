import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:dockbox_voice/app.dart';

void main() {
  testWidgets('App renders home screen', (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(child: DockboxVoiceApp()),
    );

    // Verify the app title is present
    expect(find.text('Dockbox Voice'), findsOneWidget);

    // Verify the talk button hint is present
    expect(find.text('TAP TO TALK'), findsOneWidget);
  });
}
