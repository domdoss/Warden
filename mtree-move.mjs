// Move the 5 tradingagents facts from Client Sites > AION Systems to
// Finance > Trading > Local Alpha Stack (misfiled by the classifier; the
// facts themselves are good). Delete + re-file with the corrected path.
const MARM = 'http://127.0.0.1:8001/mcp';
const SESSION = 'memory tree-2026-09-10';
const WRONG = 'Projects > Client Sites > AION Systems';
const RIGHT = 'Finance > Trading > Local Alpha Stack';

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
  for (const c of [...(r.result?.content || [])].reverse()) {
    if (c.type === 'text' && c.text.trim().startsWith('{')) return JSON.parse(c.text);
  }
  throw new Error('no JSON block in result');
}

await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'mtree-move', version: '1.0' } } }, false);
await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });

const show = await call('marm_log_show', { session_name: SESSION });
const entries = show.entries || [];
const moved = [];
for (const e of entries) {
  const raw = String(e.full_entry || e.summary || '');
  const m = raw.match(/^memory tree — ([^:]+): ([\s\S]*)$/);
  if (!m) continue;
  if (m[1].trim() === WRONG && /tradingagents|alpha[\s-]*stack|start_alpha/i.test(m[2])) {
    moved.push({ id: e.id, fact: m[2].trim() });
  }
}
console.log('moving:', moved.length);

for (const mo of moved) {
  await call('marm_delete', { type: 'log', target: mo.id, session_name: SESSION });
  await new Promise((r) => setTimeout(r, 2500));
  await call('marm_log_entry', { entry: `memory tree — ${RIGHT}: ${mo.fact}` });
  console.log('moved:', mo.fact.slice(0, 70));
  await new Promise((r) => setTimeout(r, 2500));
}
console.log('DONE');