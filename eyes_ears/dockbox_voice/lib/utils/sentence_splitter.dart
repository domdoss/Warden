/// Accumulates SSE text chunks and splits them into speakable sentences.
///
/// Ported from main.py _join_chunks and _tts_loop sentence-splitting logic.
class SentenceSplitter {
  final List<String> _buffer = [];

  /// Add a chunk. Returns any complete sentences that can be spoken now.
  List<String> addChunk(String chunk) {
    _buffer.add(chunk);
    return _extractSentences();
  }

  /// Flush remaining buffer. Returns whatever is left as a single string.
  String flush() {
    final text = _join(_buffer).trim();
    _buffer.clear();
    return text;
  }

  List<String> _extractSentences() {
    final result = <String>[];
    final joined = _join(_buffer);

    for (final sep in ['.', '!', '?', '\n']) {
      if (joined.contains(sep)) {
        final idx = joined.lastIndexOf(sep);
        final head = joined.substring(0, idx + 1);
        final tail = joined.substring(idx + 1);

        _buffer.clear();
        if (tail.trim().isNotEmpty) {
          _buffer.add(tail);
        }
        if (head.trim().isNotEmpty) {
          result.add(head);
        }
        break;
      }
    }
    return result;
  }

  /// Join chunks with spaces, then clean up spacing around punctuation.
  /// Ported from main.py _join_chunks.
  static String _join(List<String> chunks) {
    if (chunks.isEmpty) return '';
    String text = chunks.join(' ');
    // Remove space before punctuation
    text = text.replaceAll(RegExp(r' (?=[.,;:!?)\]}])'), '');
    // Fix contractions: word + apostrophe + short suffix
    text = text.replaceAll(
      RegExp(r"(\w) ' (ll|re|ve|s|d|t|m)\b", caseSensitive: false),
      r"\1'\2",
    );
    return text;
  }
}
