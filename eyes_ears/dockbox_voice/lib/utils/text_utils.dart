/// Text processing utilities ported from main.py.
class TextUtils {
  TextUtils._();

  // Emoji/pictograph regex — ported from main.py _EMOJI_RE
  static final RegExp _emojiRe = RegExp(
    '['
    '\u{1F300}-\u{1FAFF}' // symbols & pictographs
    '\u{1F1E6}-\u{1F1FF}' // regional indicators (flags)
    '\u{2600}-\u{27BF}' // misc symbols + dingbats
    '\u{2190}-\u{21FF}' // arrows
    '\u{2B00}-\u{2BFF}' // misc symbols & arrows
    '\u{FE00}-\u{FE0F}' // variation selectors
    '\u{200D}' // zero-width joiner
    '\u{24C2}\u{2122}\u{2139}\u{3030}\u{303D}'
    ']+',
    unicode: true,
  );

  /// Strip markdown formatting so TTS speaks plain prose.
  /// Ported from main.py _strip_markdown.
  static String stripMarkdown(String text) {
    text = text.replaceAll(RegExp(r'```[\s\S]*?```'), ' ');
    text = text.replaceAll(RegExp(r'`([^`]*)`'), r'\1');
    text = text.replaceAll(RegExp(r'!?\[([^\]]*)\]\([^)]*\)'), r'\1');
    text = text.replaceAll(RegExp(r'^\s*>+\s?', multiLine: true), '');
    text = text.replaceAll(RegExp(r'^\s{0,3}#{1,6}\s*', multiLine: true), '');
    text = text.replaceAll(RegExp(r'^\s*([-*+]|\d+\.)\s+', multiLine: true), '');
    text = text.replaceAll(RegExp(r'(\*\*|__)(.*?)\1'), r'\2');
    text = text.replaceAll(RegExp(r'(\*|_)(.*?)\1'), r'\2');
    text = _emojiRe.allMatches(text).fold(text, (s, m) => s.replaceFirst(m.group(0)!, ''));
    text = text.replaceAll(RegExp(r'[ \t]+'), ' ');
    return text.trim();
  }

  /// True when the assistant's reply bids the user farewell.
  /// Ported from main.py _isSignoff.
  static bool isSignoff(String reply) {
    final t = reply.toLowerCase();
    const cues = [
      'goodbye', 'good bye', 'bye for now', 'farewell',
      'take care', 'good night', 'goodnight',
      'have a great', 'have a good', 'have a wonderful', 'have a nice',
      'talk to you later', 'talk to you soon', 'talk soon',
      'see you later', 'see you soon', 'see you next', 'until next time',
      'feel free to reach out', 'reach out whenever', 'reach out if you',
      "i'm here if you", "im here if you", 'here if you need',
      'here whenever you need', 'anything else later', 'need anything later',
      'signing off', 'rest well', 'enjoy the rest of your',
    ];
    return cues.any((c) => t.contains(c));
  }

  /// True when the user clearly signals they're done.
  /// Ported from main.py _userEnded.
  static bool userEnded(String text) {
    final cleaned = text
        .toLowerCase()
        .replaceAll("'", "'")
        .replaceAll(RegExp(r"[^a-z']+"), ' ')
        .trim();

    if (['stop', 'exit', 'goodbye', 'bye'].contains(cleaned)) return true;

    final padded = ' $cleaned ';
    const phrases = [
      "that's it", "thats it", "that's all", "thats all",
      "that'll be all", "that will be all", "that is all",
      "i'm done", "im done", "we're done", "we are done", "all done",
      "nothing else", "no thanks", "no thank you",
      "good night", "goodnight",
      "i'm good", "im good", "we're good",
      "that's everything", "thats everything",
    ];
    return phrases.any((p) => padded.contains(' $p '));
  }
}
