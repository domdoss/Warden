/**
 * Stateless CardDAV client for the local Radicale hub.
 *
 * Mirrors caldav.ts: no cache, no stored state, live HTTP per call. Etags used
 * per-request only. Collection at /card/ holds one vCard per resource at
 * /card/<uid>.vcf.
 *
 * Config: RADICALE_CARD_COLLECTION (default /card/), shares RADICALE_URL and
 * RADICALE_USER/PASS with caldav.ts.
 */

import { generateVCard, parseVCard, vcardSearchText, type VCard } from '../vcard.js';

const RADICALE_URL = (process.env.RADICALE_URL || 'http://127.0.0.1:5232').replace(/\/+$/, '');
const CARD_COLLECTION = process.env.RADICALE_CARD_COLLECTION || '/card/';
const RADICALE_USER = process.env.RADICALE_USER || '';
const RADICALE_PASS = process.env.RADICALE_PASS || '';

function authHeader(): Record<string, string> {
  if (!RADICALE_USER) return {};
  const token = Buffer.from(`${RADICALE_USER}:${RADICALE_PASS}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

async function davRequest(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const url = RADICALE_URL + (path.startsWith('/') ? path : '/' + path);
  const res = await fetch(url, {
    method,
    headers: { ...authHeader(), ...(opts.headers || {}) },
    body: opts.body,
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  return { status: res.status, headers, body: await res.text() };
}

// ---------------------------------------------------------------------------
// Multistatus parsing (tolerant, namespace-stripped)
// ---------------------------------------------------------------------------

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function matchTag(block: string, localName: string): string | undefined {
  const re = new RegExp(
    `<(?:[A-Za-z0-9]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9]+:)?${localName}>`, 'i',
  );
  const m = re.exec(block);
  return m ? m[1].trim() : undefined;
}

interface CardDavObject {
  href: string;
  etag: string;
  vcf: string;
}

function parseMultiStatus(xml: string): CardDavObject[] {
  const out: CardDavObject[] = [];
  const respRe = /<(?:[A-Za-z0-9]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?response>/gi;
  let m: RegExpExecArray | null;
  while ((m = respRe.exec(xml)) !== null) {
    const block = m[1];
    const href = matchTag(block, 'href');
    const etag = matchTag(block, 'getetag');
    const vcfRaw = matchTag(block, 'address-data');
    if (!href) continue;
    out.push({ href, etag: etag || '', vcf: vcfRaw ? unescapeXml(vcfRaw) : '' });
  }
  return out;
}

function objectPath(uid: string): string {
  const base = CARD_COLLECTION.endsWith('/') ? CARD_COLLECTION : CARD_COLLECTION + '/';
  return `${base}${uid}.vcf`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CardDavContact extends VCard {
  etag?: string;
  href?: string;
}

export async function listContacts(): Promise<CardDavContact[]> {
  // Radicale only returns address-data through a REPORT addressbook-query; a
  // PROPFIND asking for it yields 404 propstats with empty bodies.
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<CR:addressbook-query xmlns:D="DAV:" xmlns:CR="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:getetag/>
    <CR:address-data/>
  </D:prop>
</CR:addressbook-query>`;
  const { status, body: xml } = await davRequest('REPORT', CARD_COLLECTION, {
    headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body,
  });
  if (status >= 400) throw new Error(`CardDAV REPORT failed: ${status}`);
  const objs = parseMultiStatus(xml);
  const contacts: CardDavContact[] = [];
  for (const o of objs) {
    if (!o.vcf) continue;
    const c = parseVCard(o.vcf);
    if (c) contacts.push({ ...c, etag: o.etag, href: o.href });
  }
  return contacts;
}

export async function searchContacts(query: string): Promise<CardDavContact[]> {
  const q = query.toLowerCase();
  const all = await listContacts();
  return all.filter((c) => vcardSearchText(c).includes(q));
}

export async function getContact(uid: string): Promise<CardDavContact | null> {
  const { status, body, headers } = await davRequest('GET', objectPath(uid));
  if (status === 404) return null;
  if (status >= 400) throw new Error(`CardDAV GET failed: ${status}`);
  const c = parseVCard(body);
  return c ? { ...c, etag: headers.etag, href: objectPath(uid) } : null;
}

export async function upsertContact(
  c: VCard, etag?: string,
): Promise<{ ok: true; uid: string; etag: string } | { ok: false; error: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'text/vcard; charset=utf-8' };
  if (etag) headers['If-Match'] = etag;
  else headers['If-None-Match'] = '*';
  const { status, body, headers: rh } = await davRequest('PUT', objectPath(c.uid), {
    headers,
    body: generateVCard(c),
  });
  if (status >= 400) return { ok: false, error: `PUT ${status}: ${body.slice(0, 300)}` };
  return { ok: true, uid: c.uid, etag: rh.etag || '' };
}

export async function deleteContact(uid: string, etag?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const headers: Record<string, string> = {};
  if (etag) headers['If-Match'] = etag;
  const { status, body } = await davRequest('DELETE', objectPath(uid), { headers });
  if (status === 404) return { ok: true };
  if (status >= 400) return { ok: false, error: `DELETE ${status}: ${body.slice(0, 300)}` };
  return { ok: true };
}

export async function ensureCardCollection(): Promise<boolean> {
  const { status } = await davRequest('MKCOL', CARD_COLLECTION);
  return status === 201 || status === 405 || status === 301;
}