// Count remaining memory-tree entries by path (purge verification).
const MARM = 'http://127.0.0.1:8001/mcp';
const SESSION = 'memory tree-2026-09-10';
let sid;
async function rpc(body, withSession = true) {
  const res = await fetch(MARM, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(withSession && sid ? { 'mcp-session-id': sid } : {}) },
    body: JSON.stringify(body),
  });
  const ns = res.headers.get('mcp-session-id');
  if (ns) sid = ns;
  let text = await res.text();
  if ((res.headers.get('content-type') || '').includes('event-stream')) {
    const l = text.split('\n').find((l) => l.startsWith('data:'));
    text = l ? l.slice(5).trim() : '';
  }
  if (!text.trim()) return null;
  return JSON.parse(text);
}
async function call(name, args) {
  const r = await rpc({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } });
  if (!r || r.error) throw new Error('rpc error');
  for (const c of [...(r.result?.content || [])].reverse()) {
    if (c.type === 'text' && c.text.trim().startsWith('{')) return JSON.parse(c.text);
  }
  throw new Error('no JSON block');
}
await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'mtree-count', version: '1.0' } } }, false);
await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
const show = await call('marm_log_show', { session_name: SESSION });
const entries = show.entries || [];
const counts = {};
for (const e of entries) {
  const m = String(e.full_entry || e.summary || '').match(/memory tree — ([^:]+):/);
  if (!m) { counts['(unparsed)'] = (counts['(unparsed)'] || 0) + 1; continue; }
  const p = m[1].trim();
  counts[p] = (counts[p] || 0) + 1;
}
console.log('total entries:', entries.length);
const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
for (const [p, n] of sorted.slice(0, 15)) console.log(String(n).padStart(3), p);