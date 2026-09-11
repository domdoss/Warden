// Purge the junk already filed: every MARM Memory entry (user: don't want
// the node at all) + later paraphrase restatements of a same-path fact
// (same word-overlap logic as the host-side filter). Paced for MARM's
// ~80 req/min limit shared with the live classifier.
const MARM = 'http://127.0.0.1:8001/mcp';
const SESSION = 'memory tree-2026-09-10';
const SKIP_PATH = 'Projects > AI & Tools > MARM Memory';

const STOP = new Set(['the', 'and', 'with', 'has', 'have', 'had', 'for', 'are', 'was', 'from', 'this', 'that', 'its', 'also', 'user', 'users']);
function words(s) {
  return new Set(s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2 && !STOP.has(w)));
}
function sameFact(a, b) {
  const A = words(a), B = words(b);
  if (A.size < 2 || B.size < 2) return false;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size) >= 0.75;
}

let sid;
async function rpc(body, withSession = true) {
  const res = await fetch(MARM, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(withSession && sid ? { 'mcp-session-id': sid } : {}),
    },
    body: JSON.stringify(body),
  });
  const ns = res.headers.get('mcp-session-id');
  if (ns) sid = ns;
  let text = await res.text();
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('event-stream')) {
    const l = text.split('\n').find((l) => l.startsWith('data:'));
    text = l ? l.slice(5).trim() : '';
  }
  if (!text.trim()) return null;
  return JSON.parse(text);
}
async function call(name, args) {
  const r = await rpc({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } });
  if (!r) throw new Error('empty result');
  if (r.error) throw new Error(String(r.error.message || 'rpc error').slice(0, 100));
  // MARM prepends banner content blocks — the JSON is the last one.
  for (const c of [...(r.result?.content || [])].reverse()) {
    if (c.type === 'text' && c.text.trim().startsWith('{')) return JSON.parse(c.text);
  }
  throw new Error('no JSON block in result');
}

await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'mtree-purge', version: '1.0' } } }, false);
await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });

const show = await call('marm_log_show', { session_name: SESSION });
const entries = show.entries || [];
console.log('entries in session:', entries.length);

const seen = []; // kept: {path, fact}
const toDelete = [];
for (const e of entries) {
  const raw = String(e.full_entry || e.summary || '');
  const m = raw.match(/memory tree — ([^:]+): ([\s\S]*)/);
  if (!m) continue;
  const path = m[1].trim();
  const fact = m[2].trim();
  if (path === SKIP_PATH) { toDelete.push({ id: e.id, why: 'marm-memory' }); continue; }
  if (seen.some((k) => sameFact(k.fact, fact))) { toDelete.push({ id: e.id, why: 'paraphrase' }); continue; }
  seen.push({ path, fact });
}
console.log('to delete:', toDelete.length, '(marm:', toDelete.filter((d) => d.why === 'marm-memory').length, 'paraphrase:', toDelete.filter((d) => d.why === 'paraphrase').length, ')');

let ok = 0, fail = 0;
for (const d of toDelete) {
  try { await call('marm_delete', { type: 'log', target: d.id, session_name: SESSION }); ok++; }
  catch (e) { fail++; console.log('fail', d.id, String(e.message).slice(0, 60)); await new Promise((r) => setTimeout(r, 15000)); }
  await new Promise((r) => setTimeout(r, 2500));
}
console.log('DONE — deleted:', ok, 'still failing:', fail);