/**
 * vCard (.vcf) generation and parsing — no external dependencies.
 *
 * Supports vCard 3.0/4.0 basics: FN, N, EMAIL (with TYPE), TEL (with TYPE),
 * ORG, TITLE, NOTE, UID, plus round-tripping any other property verbatim via
 * `extra`. Line folding/unfolding follows RFC 6350 (75-octet fold, unfold on
 * CRLF+space or LF+space).
 *
 * One contact = one vCard. CardDAV stores one vCard per resource at
 * /card/<uid>.vcf.
 */

export interface VCard {
  uid: string;
  fullName?: string;       // FN
  givenName?: string;       // N = family;given;additional;prefix;suffix
  familyName?: string;
  additionalName?: string;
  honorificPrefix?: string;
  honorificSuffix?: string;
  email?: string[];        // EMAIL values (first address used for the email field)
  phone?: string[];         // TEL values
  org?: string;             // ORG (organization ; unit ; unit)
  title?: string;           // TITLE
  note?: string;            // NOTE
  /** Raw lines for properties we don't model, preserved for round-trip. */
  extra?: string[];
}

// ---------------------------------------------------------------------------
// Fold / unfold
// ---------------------------------------------------------------------------

function foldLine(line: string): string {
  const parts: string[] = [];
  let remaining = line;
  while (remaining.length > 75) {
    parts.push(remaining.slice(0, 75));
    remaining = ' ' + remaining.slice(75);
  }
  parts.push(remaining);
  return parts.join('\r\n');
}

function unfold(raw: string): string[] {
  return raw.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/).filter((l) => l.length > 0);
}

// ---------------------------------------------------------------------------
// Escaping (vCard 3.0 text values: escape \ , ; and newline)
// ---------------------------------------------------------------------------

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
}

function unescapeText(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

export function generateVCard(c: VCard): string {
  const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0'];
  lines.push(foldLine(`UID:${escapeText(c.uid)}`));
  // FN is mandatory in vCard 3.0 — Radicale rejects cards without it.
  const fn = c.fullName
    || [c.givenName, c.familyName].filter(Boolean).join(' ')
    || (c.email && c.email[0])
    || c.uid;
  lines.push(foldLine(`FN:${escapeText(fn)}`));
  if (c.familyName || c.givenName || c.additionalName || c.honorificPrefix || c.honorificSuffix) {
    const n = [
      c.familyName || '',
      c.givenName || '',
      c.additionalName || '',
      c.honorificPrefix || '',
      c.honorificSuffix || '',
    ].map(escapeText).join(';');
    lines.push(foldLine(`N:${n}`));
  }
  for (const e of c.email || []) lines.push(foldLine(`EMAIL:${escapeText(e)}`));
  for (const p of c.phone || []) lines.push(foldLine(`TEL:${escapeText(p)}`));
  if (c.org) lines.push(foldLine(`ORG:${escapeText(c.org)}`));
  if (c.title) lines.push(foldLine(`TITLE:${escapeText(c.title)}`));
  if (c.note) lines.push(foldLine(`NOTE:${escapeText(c.note)}`));
  for (const x of c.extra || []) lines.push(foldLine(x));
  lines.push('END:VCARD');
  return lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

function parseN(value: string): Partial<VCard> {
  const parts = value.split(';').map(unescapeText);
  return {
    familyName: parts[0] || undefined,
    givenName: parts[1] || undefined,
    additionalName: parts[2] || undefined,
    honorificPrefix: parts[3] || undefined,
    honorificSuffix: parts[4] || undefined,
  };
}

export function parseVCard(raw: string): VCard | null {
  const lines = unfold(raw);
  if (!lines.some((l) => l.toUpperCase() === 'BEGIN:VCARD')) return null;

  const c: VCard = { uid: '', email: [], phone: [], extra: [] };
  let inCard = false;

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === 'BEGIN:VCARD') { inCard = true; continue; }
    if (upper === 'END:VCARD') break;
    if (!inCard) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const keyPart = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1);
    const name = keyPart.split(';')[0].toUpperCase();
    const v = unescapeText(value);

    switch (name) {
      case 'UID': c.uid = v; break;
      case 'FN': c.fullName = v; break;
      case 'N': Object.assign(c, parseN(value)); break;
      case 'EMAIL': c.email!.push(v); break;
      case 'TEL': c.phone!.push(v); break;
      case 'ORG': c.org = v; break;
      case 'TITLE': c.title = v; break;
      case 'NOTE': c.note = v; break;
      case 'VERSION': break; // ignore
      default:
        // Preserve unmodeled properties for round-trip (e.g. ADR, BDAY, PHOTO).
        if (!c.extra!) c.extra = [];
        c.extra.push(line);
    }
  }

  return c;
}

/** Flatten a VCard to a simple searchable string (all fields joined). */
export function vcardSearchText(c: VCard): string {
  return [
    c.fullName || '',
    c.givenName || '',
    c.familyName || '',
    ...(c.email || []),
    ...(c.phone || []),
    c.org || '',
    c.title || '',
    c.note || '',
  ].join(' ').toLowerCase();
}