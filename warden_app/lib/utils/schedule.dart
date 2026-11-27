/// Human-readable schedule formatting. Never show raw cron to a human.
String humanCron(String cron) {
  final c = cron.trim();
  if (c.isEmpty) return '—';
  final p = c.split(RegExp(r'\s+'));
  if (p.length < 5) return _friendly(c);

  final min = p[0], hour = p[1], dom = p[2], dow = p[4];

  if (min.startsWith('*/')) {
    final n = min.substring(2);
    final v = int.tryParse(n);
    if (v != null) return 'Every $v minute${v == 1 ? '' : 's'}';
  }

  final hm = _timeOfDay(hour, min);
  if (dow != '*' && dom == '*') {
    final days = _daysOfWeek(dow);
    if (days != null) return '$days at $hm';
  }
  if (dom != '*' && dow == '*') {
    final d = int.tryParse(dom);
    if (d != null) return 'On day $d of the month at $hm';
  }
  if (hour != '*' && min != '*' && dom == '*' && dow == '*') {
    return 'Daily at $hm';
  }
  return 'Custom schedule';
}

/// Format a task schedule from its type + value (cron, interval, one-time).
String humanScheduleValue(String type, String value) {
  final t = type.toLowerCase();
  if (t == 'interval' || t == 'every') return humanDuration(value);
  if (t == 'once' || t == 'one-shot' || t == 'oneoff' || t == 'one_time') {
    return 'One-time';
  }
  if (t == 'daily') {
    final hm = RegExp(r'(\d{1,2}):(\d{2})').firstMatch(value);
    if (hm != null) return 'Daily at ${_timeOfDay(hm.group(1)!, hm.group(2)!)}';
    return 'Daily';
  }
  return humanCron(value);
}

/// PT3H -> "Every 3h", PT10M -> "Every 10m", PT1H30M -> "Every 1h 30m".
String humanDuration(String iso) {
  final m = RegExp(r'^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$')
      .firstMatch(iso.trim());
  if (m == null) return iso;
  final h = int.tryParse(m.group(1) ?? '') ?? 0;
  final min = int.tryParse(m.group(2) ?? '') ?? 0;
  final s = int.tryParse(m.group(3) ?? '') ?? 0;
  final parts = <String>[];
  if (h > 0) parts.add('${h}h');
  if (min > 0) parts.add('${min}m');
  if (s > 0) parts.add('${s}s');
  return parts.isEmpty ? 'Every moment' : 'Every ${parts.join(' ')}';
}

String _friendly(String c) {
  // Non-cron schedule strings (e.g. ISO times or named intervals).
  if (c.contains(':')) return c;
  return c.isEmpty ? '—' : c;
}

String _timeOfDay(String hour, String min) {
  final h = int.tryParse(hour);
  final m = int.tryParse(min);
  if (h == null || m == null) return hour.contains('*') ? hour : '$hour:$min';
  final period = h >= 12 ? 'PM' : 'AM';
  final h12 = h % 12 == 0 ? 12 : h % 12;
  return '$h12:${m.toString().padLeft(2, '0')} $period';
}

String? _daysOfWeek(String dow) {
  if (dow == '1-5') return 'Weekdays';
  if (dow == '0,6' || dow == '6,0' || dow == '0-6') return 'Weekends';
  const names = {
    '0': 'Sundays', '1': 'Mondays', '2': 'Tuesdays', '3': 'Wednesdays',
    '4': 'Thursdays', '5': 'Fridays', '6': 'Saturdays',
  };
  final parts = dow.split(',');
  if (parts.every((d) => names.containsKey(d))) {
    return parts.map((d) => names[d]).join(', ');
  }
  return null;
}

/// Format an ISO timestamp into "Nov 25, 9:14 AM" (local), or '' on error.
String humanDateTime(String iso) {
  final t = DateTime.tryParse(iso);
  if (t == null) return iso;
  final local = t.toLocal();
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  final h = local.hour % 12 == 0 ? 12 : local.hour % 12;
  final period = local.hour >= 12 ? 'PM' : 'AM';
  return '${months[local.month - 1]} ${local.day}, $h:${local.minute.toString().padLeft(2, '0')} $period';
}
