/**
 * A general phone-agent harness.
 *
 * A loop is: a name, a goal, an optional skill file, an interval, and on/off.
 * The agent gets its goal + skill as instructions and a shell to do the work.
 * Nothing here knows what LinkedIn or any app is.
 */
import fs from 'fs';
import path from 'path';
import dgram from 'dgram';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { logger } from './logger.js';
import { DATA_DIR, OLLAMA_URL } from './config.js';
import { ollamaChat, type OllamaTool, type OllamaMessage } from './ollama-native.js';

const execFileAsync = promisify(execFile);

const ADB = '/home/user/.local/share/android-platform-tools/platform-tools/adb';
const PHONE = '/home/user/your-project/.opencode/skills/phone-control/scripts/phone-control';

const STATE_PATH = path.join(DATA_DIR, 'mobile-state.json');
const JOURNAL_PATH = path.join(DATA_DIR, 'mobile-journal.jsonl');
const FRAME_PATH = path.join(DATA_DIR, 'mobile-frame.jpg');
const LOOPS_PATH = path.join(DATA_DIR, 'mobile-loops.json');
const MODEL_PATH = path.join(DATA_DIR, 'mobile-model.txt');

interface Entry { ts: number; action: string; text: string; result: string; error?: string }

interface Loop {
  id: string;
  name: string;
  description?: string;
  goal: string;
  skill: string;
  intervalMin: number;
  intervalMaxMin?: number;   // when set, the gap is randomised in [intervalMin, intervalMaxMin]
  enabled: boolean;
}

interface State {
  enabled: boolean;
  model: string;
  device: string | null;
  lastError: string;
  activeLoop: string;
  lastRun: Record<string, number>;
  nextGap: Record<string, number>;   // minutes chosen for the current interval
  journal: Entry[];
}

const TOOLS: OllamaTool[] = [
  { type: 'function', function: { name: 'bash', description: 'Run a shell command and read its output', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'done', description: 'Finish this cycle', parameters: { type: 'object', properties: {} } } },
];

const DEFAULT_LOOPS: Loop[] = [
  {
    id: 'linkedin-engage',
    name: 'LinkedIn — engage',
    goal: "One LinkedIn cycle. Report each command's output. If any command prints QUIET_HOURS, stop immediately and call done.\n1) Replies: run\nbash /home/user/your-project/.opencode/skills/linkedin-phone/scripts/engage.sh replies\nIf it lists anyone, run\nbash /home/user/your-project/.opencode/skills/linkedin-phone/scripts/engage.sh openreply 1\nIf that prints 'DECISION: REPLY', write ONE specific reply that answers what they actually said (no agreement or praise replies, no pitch, no invented facts, no emoji) and send it with\nbash /home/user/your-project/.opencode/skills/linkedin-phone/scripts/engage.sh reply - <<'TXT'\n<your reply>\nTXT\nIf it prints 'DECISION: NO_REPLY' or 'NO_TEXT', try\nbash /home/user/your-project/.opencode/skills/linkedin-phone/scripts/engage.sh openreply 2\n(then 3 if needed), and act only on a REPLY decision.\n2) Connection requests: run\nbash /home/user/your-project/.opencode/skills/linkedin-phone/scripts/engage.sh invites accept\n3) Post reminder: run\nbash /home/user/your-project/.opencode/skills/linkedin-phone/scripts/engage.sh due\nIf it prints POST_DUE, write ONE engaging, thought-provoking post (3-5 hashtags, a specific hook, no invented facts, no link in the first line) and publish it with\nbash /home/user/your-project/.opencode/skills/linkedin-phone/scripts/engage.sh publish \"<text>\"\nConfirm it prints 'publish: POSTED'. If it prints NOT_DUE, skip posting.\n4) Outbound: run\nbash /home/user/your-project/.opencode/skills/linkedin-phone/scripts/engage.sh plan\nIt prints the candidate table and 'DECISION: COMMENT <i>' or 'DECISION: NO_COMMENT'. Like the genuinely good posts with\nbash /home/user/your-project/.opencode/skills/linkedin-phone/scripts/engage.sh like <indices>\nOnly if the decision is COMMENT <i>, write ONE specific professional comment and post it with\nbash /home/user/your-project/.opencode/skills/linkedin-phone/scripts/engage.sh comment <i> - <<'TXT'\n<your comment>\nTXT\nIf the decision is NO_COMMENT, do NOT comment. Then call done.",
    skill: '/opt/Warden/data/skills/linkedin-mobile/SKILL.md',
    intervalMin: 0,
    enabled: true,
  },

];

function readLoops(): Loop[] {
  try {
    const raw = JSON.parse(fs.readFileSync(LOOPS_PATH, 'utf-8'));
    if (Array.isArray(raw?.loops)) return raw.loops;
  } catch { /* first run */ }
  return DEFAULT_LOOPS;
}

let loops: Loop[] = readLoops();

function saveLoops(next: Loop[] = loops): void {
  loops = next;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LOOPS_PATH, JSON.stringify({ loops }, null, 2), 'utf-8');
  } catch (err) { logger.warn({ err: String(err) }, 'mobile: save loops failed'); }
}

function loadState(): State {
  let s: Partial<State> = {};
  try { if (fs.existsSync(STATE_PATH)) s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')); } catch { /* fresh */ }
  let journal: Entry[] = [];
  try {
    journal = fs.readFileSync(JOURNAL_PATH, 'utf-8').trim().split('\n').slice(-100)
      .map((l) => { try { return JSON.parse(l) as Entry; } catch { return null; } })
      .filter(Boolean) as Entry[];
  } catch { /* no journal */ }
  return {
    enabled: s.enabled === true,
    model: (() => { try { return fs.readFileSync(MODEL_PATH, 'utf-8').trim() || 'qwen3.6:35b'; } catch { return 'qwen3.6:35b'; } })(),
    device: s.device ?? null,
    lastError: s.lastError ?? '',
    activeLoop: s.activeLoop ?? '',
    lastRun: s.lastRun ?? {},
    nextGap: s.nextGap ?? {},
    journal,
  };
}

const state: State = loadState();

function save(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const { journal, ...rest } = state;
    fs.writeFileSync(STATE_PATH, JSON.stringify(rest, null, 2), 'utf-8');
  } catch (err) { logger.warn({ err: String(err) }, 'mobile: save failed'); }
}

function journal(action: string, text: string, result: string, error?: string): void {
  const e: Entry = { ts: Date.now(), action, text, result, error };
  state.journal.push(e);
  if (state.journal.length > 100) state.journal = state.journal.slice(-100);
  try { fs.appendFileSync(JOURNAL_PATH, JSON.stringify(e) + '\n', 'utf-8'); } catch { /* best effort */ }
}

const TOOL_PATH = [
  '/home/user/.local/share/android-platform-tools/platform-tools',
  '/home/user/.local/bin',
  '/usr/local/bin', '/usr/bin', '/bin',
].join(':');

async function run(cmd: string, args: string[], timeoutMs = 60_000): Promise<{ code: number; out: string }> {
  try {
    const env = { ...process.env, PATH: `${TOOL_PATH}:${process.env.PATH || ''}`, PYTHONUNBUFFERED: '1' };
    const { stdout } = await execFileAsync(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env });
    return { code: 0, out: (stdout || '').trim() };
  } catch (err: any) {
    const out = [err?.stdout, err?.stderr, err?.message].filter(Boolean).join('\n');
    return { code: err?.code ?? 1, out: String(out || err) };
  }
}

let SERIAL = '';
let SERIAL_AT = 0;
async function serial(): Promise<string> {
  // short cache only: phones come and go, especially over wireless debugging
  if (SERIAL && Date.now() - SERIAL_AT < 2000) return SERIAL;
  const d = await run(ADB, ['devices'], 10_000);
  // wireless-debug serials can be mDNS names (no port), so match any device line
  const line = d.out.split('\n').find((l) => /\tdevice\b/.test(l)) || '';
  SERIAL = line.split('\t')[0].trim() || '';
  SERIAL_AT = Date.now();
  return SERIAL;
}

// ── mDNS: find the phone's wireless-debug endpoint on the LAN ──
interface RR { name: string; type: number; data: any }

function encodeName(name: string): Buffer {
  const labels = name.split('.').filter(Boolean);
  return Buffer.concat([
    ...labels.map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])),
    Buffer.from([0]),
  ]);
}

function encodeQuery(name: string, qtype: number): Buffer {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(1, 4); // qdcount
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(qtype, 0);
  tail.writeUInt16BE(1, 2); // IN
  return Buffer.concat([head, encodeName(name), tail]);
}

function readName(buf: Buffer, off: number): { name: string; next: number } {
  const labels: string[] = [];
  let next = off;
  let jumped = false;
  for (let guard = 0; guard < 128; guard++) {
    const len = buf[off];
    if (len === undefined) break;
    if ((len & 0xc0) === 0xc0) {
      if (!jumped) next = off + 2;
      off = ((len & 0x3f) << 8) | buf[off + 1];
      jumped = true;
      continue;
    }
    off++;
    if (len === 0) { if (!jumped) next = off; break; }
    labels.push(buf.toString('utf8', off, off + len));
    off += len;
  }
  return { name: labels.join('.'), next };
}

function parseAnswers(buf: Buffer): RR[] {
  const qd = buf.readUInt16BE(4);
  const an = buf.readUInt16BE(6);
  let off = 12;
  for (let i = 0; i < qd; i++) off = readName(buf, off).next + 4;
  const out: RR[] = [];
  for (let i = 0; i < an; i++) {
    const r = readName(buf, off);
    off = r.next;
    const type = buf.readUInt16BE(off);
    const rdlen = buf.readUInt16BE(off + 8);
    const rd = off + 10;
    let data: any = null;
    if (type === 12) data = readName(buf, rd).name; // PTR
    else if (type === 33) data = { port: buf.readUInt16BE(rd + 4), target: readName(buf, rd + 6).name }; // SRV
    else if (type === 1) data = `${buf[rd]}.${buf[rd + 1]}.${buf[rd + 2]}.${buf[rd + 3]}`; // A
    off = rd + rdlen;
    out.push({ name: r.name, type, data });
  }
  return out;
}

function mdnsQuery(name: string, qtype: number, timeoutMs = 2000): Promise<RR[]> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const found: RR[] = [];
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { sock.close(); } catch { /* already closed */ }
      resolve(found);
    };
    const timer = setTimeout(done, timeoutMs);
    sock.on('message', (msg) => { try { found.push(...parseAnswers(msg)); } catch { /* skip bad packet */ } });
    sock.on('error', done);
    sock.bind(5353, () => {
      try { sock.addMembership('224.0.0.251'); } catch { /* multicast unavailable */ }
      const q = encodeQuery(name, qtype);
      sock.send(q, 0, q.length, 5353, '224.0.0.251', () => { /* best effort */ });
    });
  });
}

/** Resolve the wireless-debugging service(s) advertised by the phone. */
export async function mdnsAndroidTargets(): Promise<Array<{ host: string; port: number }>> {
  const svc = '_adb-tls-connect._tcp.local';
  const ptrs = (await mdnsQuery(svc, 12))
    .filter((r) => r.type === 12 && String(r.name).toLowerCase() === svc)
    .map((r) => String(r.data));
  const targets: Array<{ host: string; port: number }> = [];
  for (const inst of ptrs) {
    const srv = (await mdnsQuery(inst, 33)).find(
      (r) => r.type === 33 && r.name.toLowerCase() === inst.toLowerCase());
    if (!srv) continue;
    const a = (await mdnsQuery(srv.data.target, 1)).find(
      (r) => r.type === 1 && r.name.toLowerCase() === String(srv.data.target).toLowerCase());
    if (a) {
      const host = String(a.data);
      if (!targets.some((t) => t.host === host && t.port === Number(srv.data.port))) {
        targets.push({ host, port: Number(srv.data.port) });
      }
    }
  }
  return targets;
}

function normalizeAddress(v: string): string {
  const s = v.trim();
  if (!s) return '';
  if (/^[^\s:]+:\d+$/.test(s)) return s;
  return `${s}:5555`; // classic tcpip port
}

/** Connect (or report the already-connected) phone. Safe to call repeatedly. */
async function connectPhone(address?: string): Promise<{ ok: boolean; device?: string; error?: string }> {
  try {
    await run(ADB, ['start-server'], 20_000);
    const already = await serial();
    if (already) { state.device = already; state.lastError = ''; save(); return { ok: true, device: already }; }

    const candidates: string[] = [];
    const manual = normalizeAddress(address || '');
    if (manual) candidates.push(manual);
    try {
      for (const t of await mdnsAndroidTargets()) candidates.push(`${t.host}:${t.port}`);
    } catch (err) {
      logger.warn({ err: String(err) }, 'mobile: mdns lookup failed');
    }
    if (state.device) candidates.push(normalizeAddress(state.device) || state.device);

    const tried = new Set<string>();
    for (const c of candidates) {
      if (!c || tried.has(c)) continue;
      tried.add(c);
      const r = await run(ADB, ['connect', c], 25_000);
      await new Promise((res) => setTimeout(res, 800));
      const devices = await run(ADB, ['devices'], 10_000);
      const lines = devices.out.split('\n');
      const dev = lines.find((l) => l.startsWith(c) && /\tdevice\b/.test(l));
      if (dev) {
        state.device = c; state.lastError = ''; save();
        return { ok: true, device: c };
      }
      const unauth = lines.find((l) => l.startsWith(c) && /\tunauthorized\b/.test(l));
      if (unauth) {
        const error = 'Phone found but not authorized — unlock it and tap “Allow USB debugging”.';
        state.lastError = error; save();
        return { ok: false, error };
      }
      if (!/connected to|already connected/.test(r.out)) {
        logger.info({ address: c, out: r.out }, 'mobile: connect attempt failed');
      }
    }

    const error = 'No phone found. Use the same Wi‑Fi, turn on Wireless debugging, and check the address.';
    state.lastError = error; save();
    return { ok: false, error };
  } catch (err) {
    const error = String(err);
    state.lastError = error; save();
    return { ok: false, error };
  }
}

const GBOARD = 'com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME';

/** Stop must hand the keyboard back: the automation leaves ADBKeyboard selected. */
async function restoreKeyboard(): Promise<void> {
  try {
    const s = await serial();
    if (s) await run(ADB, ['-s', s, 'shell', 'ime', 'set', GBOARD], 10_000);
  } catch { /* best effort */ }
}

async function frame(): Promise<Buffer | null> {
  const r = await run(PHONE, ['frame', FRAME_PATH, '--width', '1080'], 45_000);
  if (r.code === 0 && fs.existsSync(FRAME_PATH)) {
    const b = fs.readFileSync(FRAME_PATH);
    if (b.length > 1000) return b;
  }
  return null;
}

function readSkill(file: string): string {
  if (!file) return '';
  try { return fs.readFileSync(file, 'utf-8').trim(); } catch { return ''; }
}

// ── talents: skills + prompts the phone runner can be pointed at ──
const SKILL_ROOTS = [
  path.join(DATA_DIR, 'skills'),
  path.join(process.env.HOME || '/home/user', '.opencode', 'skills'),
  '/home/user/your-project/.opencode/skills',
];

function allowedSkillPath(p: string): boolean {
  if (!p) return false;
  let real = '';
  try { real = fs.realpathSync(p); } catch { real = path.resolve(p); }
  return SKILL_ROOTS.some((root) => {
    let r = '';
    try { r = fs.realpathSync(root); } catch { r = path.resolve(root); }
    return real === r || real.startsWith(r + path.sep);
  });
}

function frontmatter(file: string): { name: string; description: string } {
  let txt = '';
  try { txt = fs.readFileSync(file, 'utf-8'); } catch { return { name: '', description: '' }; }
  const m = txt.match(/^---\n([\s\S]*?)\n---/);
  const fm = m ? m[1] : '';
  const get = (k: string) => {
    const r = new RegExp('^' + k + ':\\s*(.*)$', 'm').exec(fm);
    return r ? r[1].replace(/^["']|["']$/g, '').trim() : '';
  };
  return { name: get('name'), description: get('description') };
}

function discoverSkills(): Array<{ id: string; name: string; description: string; path: string }> {
  const out: Array<{ id: string; name: string; description: string; path: string }> = [];
  const seen = new Set<string>();
  for (const root of SKILL_ROOTS) {
    let dirs: string[] = [];
    try { dirs = fs.readdirSync(root); } catch { continue; }
    for (const d of dirs) {
      const f = path.join(root, d, 'SKILL.md');
      if (!fs.existsSync(f)) continue;
      let real = f; try { real = fs.realpathSync(f); } catch { /* keep */ }
      if (seen.has(real)) continue;
      seen.add(real);
      const fm = frontmatter(f);
      out.push({ id: d, name: fm.name || d, description: fm.description || '', path: f });
    }
  }
  return out;
}

function scaffoldSkill(id: string, name: string, description: string): string {
  const dir = path.join(DATA_DIR, 'skills', id);
  const file = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.writeFileSync(file,
      `---\nname: ${id}\ndescription: ${description || name}\n---\n\n# ${name}\n\n` +
      `Write the operating procedure here: the exact steps, commands and success checks the\n` +
      `phone runner should follow. The model gets this file plus the goal as its instructions.\n`, 'utf-8');
  }
  return file;
}

async function execute(name: string, args: Record<string, any>): Promise<boolean> {
  if (name === 'done') { journal('done', '', 'cycle complete'); return false; }
  if (name !== 'bash') { journal(name, '', 'unknown tool'); return true; }
  const command = String(args.command ?? '');
  journal('bash', command.slice(0, 200), 'running');
  const r = await run('/bin/sh', ['-lc', command], 10 * 60_000);
  journal('out', r.code === 0 ? 'ok' : 'failed',
    (r.code === 0 ? r.out.slice(-1200) : r.out.slice(-1200)) || '(no output)');
  return true;
}

async function session(loop: Loop): Promise<void> {
  state.activeLoop = loop.name;
  journal('loop', loop.name, 'start');
  const skill = readSkill(loop.skill);
  const toolList = TOOLS.map((t) => `- ${t.function.name}: ${t.function.description} (args: ${JSON.stringify(t.function.parameters)})`).join('\n');
  const sys: OllamaMessage = {
    role: 'system',
    content: loop.goal +
      (skill ? `\n\n--- skill ---\n${skill}` : '') +
      `\n\nTOOLS:\n${toolList}\n\n` +
      'Reply with ONE JSON object only, no prose: {"tool":"bash","args":{"command":"…"}} ' +
      'or {"tool":"done","args":{}}. Work step by step: one command, read the result, then the next.',
  };
  const msgs: OllamaMessage[] = [sys, { role: 'user', content: `Begin: ${loop.name}.` }];
  let misses = 0;
  for (let step = 0; step < 40 && state.enabled; step++) {
    const res: any = await ollamaChat({
      model: state.model, messages: msgs,
      options: { temperature: 0.4 }, think: false,
    } as any, OLLAMA_URL);
    const raw = (res.content || '').replace(/```json|```/g, '').trim();
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch { parsed = {}; } }
    }
    if (!parsed?.tool) {
      misses++;
      journal('raw', raw.slice(0, 200), 'no action — asked again');
      if (misses >= 3) break;
      msgs.push({ role: 'assistant', content: raw.slice(0, 1500) });
      msgs.push({ role: 'user', content: 'Reply with ONE JSON object only: {"tool":"bash","args":{"command":"…"}}' });
      continue;
    }
    misses = 0;
    msgs.push({ role: 'assistant', content: raw.slice(0, 4000) });
    const keep = await execute(String(parsed.tool), (parsed.args as Record<string, any>) || {});
    const last = state.journal[state.journal.length - 1];
    msgs.push({ role: 'user', content: `RESULT ${last?.action}: ${String(last?.result)}${last?.text ? `\n${last.text}` : ''}` });
    if (!keep) break;
    if (msgs.length > 24) msgs.splice(1, msgs.length - 24);
  }
  journal('loop', loop.name, 'finished');
}

let running = false;

function pickLoop(): Loop | null {
  const now = Date.now();
  const enabled = loops.filter((l) => l.enabled);
  const gapOf = (l: Loop) => state.nextGap[l.id] || l.intervalMin;
  const due = enabled.filter((l) => (l.intervalMin <= 0) || (now - (state.lastRun[l.id] || 0) >= gapOf(l) * 60_000));
  if (!due.length) return null;
  // scheduled loops (interval > 0) get priority so they are never starved by a continuous one
  const scheduled = due.filter((l) => l.intervalMin > 0)
    .sort((a, b) => (now - (state.lastRun[a.id] || 0)) / Math.max(1, gapOf(a)) - (now - (state.lastRun[b.id] || 0)) / Math.max(1, gapOf(b)));
  return scheduled[0] || due[0];
}

async function loop(): Promise<void> {
  if (running) return;
  running = true;
  while (state.enabled) {
    const l = pickLoop();
    if (!l) {
      for (let i = 0; i < 60 && state.enabled; i++) await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    try {
      state.device = await serial();
      state.lastError = '';
      await session(l);
      state.lastRun[l.id] = Date.now();
      if (l.intervalMaxMin && l.intervalMaxMin > l.intervalMin) {
        state.nextGap[l.id] = l.intervalMin + Math.floor(Math.random() * (l.intervalMaxMin - l.intervalMin + 1));
      } else {
        state.nextGap[l.id] = l.intervalMin;
      }
      journal('loop', l.name, `next in ${state.nextGap[l.id]}m`);
    } catch (err) {
      state.lastError = String(err);
      journal('loop', l.name, 'error', String(err));
    }
    save();
    if (!state.enabled) break;
    // human-paced, variable gap between cycles (not a fixed heartbeat)
    // 2-6 minutes: a person does not run like/comment passes back-to-back
    const gap = 120 + Math.floor(Math.random() * 241);
    for (let i = 0; i < gap && state.enabled; i++) await new Promise((r) => setTimeout(r, 1000));
  }
  running = false;
}

async function body(req: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

function send(res: any, obj: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

export async function handleMobileRequest(req: any, res: any, pathname: string): Promise<boolean> {
  try {
    if (pathname === '/api/mobile/state') {
      // read the activity fresh from disk so anything writing there shows up live
      try {
        state.journal = fs.readFileSync(JOURNAL_PATH, 'utf-8').trim().split('\n').slice(-120)
          .map((l) => { try { return JSON.parse(l) as Entry; } catch { return null; } })
          .filter(Boolean) as Entry[];
      } catch { /* no journal */ }
      const live = await serial();
      if (live) state.device = live;
      const goalText = loops.find((l) => l.name === state.activeLoop)?.goal || loops[0]?.goal || '';
      send(res, { ...state, connected: !!live, goal: goalText, objective: goalText });
      return true;
    }
    if (pathname === '/api/mobile/connect' && req.method === 'POST') {
      let address = '';
      try { address = String((JSON.parse((await body(req)).toString() || '{}')).address || ''); } catch { /* empty body */ }
      const result = await connectPhone(address);
      journal('connect', address || 'auto', result.ok ? `connected ${result.device}` : 'failed', result.error);
      send(res, result);
      return true;
    }
    if (pathname === '/api/mobile/loops' && req.method === 'GET') { send(res, { loops }); return true; }
    if (pathname === '/api/mobile/loops' && req.method === 'POST') {
      const b = JSON.parse((await body(req)).toString() || '{}');
      const incoming = b.loop as Loop | undefined;
      if (!incoming) { send(res, { ok: false, error: 'loop required' }); return true; }
      const id = incoming.id || `loop-${Date.now()}`;
      const next: Loop = {
        id,
        name: String(incoming.name || 'New loop'),
        description: String(incoming.description || ''),
        goal: String(incoming.goal || ''),
        skill: String(incoming.skill || ''),
        intervalMin: Math.max(0, Number(incoming.intervalMin) || 0),
        intervalMaxMin: incoming.intervalMaxMin ? Math.max(Number(incoming.intervalMin) || 1, Number(incoming.intervalMaxMin)) : undefined,
        enabled: incoming.enabled !== false,
      };
      const others = loops.filter((l) => l.id !== id);
      saveLoops([...others, next]);
      send(res, { ok: true, loops });
      return true;
    }
    if (pathname === '/api/mobile/loops' && req.method === 'DELETE') {
      const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
      saveLoops(loops.filter((l) => l.id !== id));
      send(res, { ok: true, loops });
      return true;
    }
    if (pathname === '/api/mobile/talents' && req.method === 'GET') {
      const skills = discoverSkills();
      send(res, { talents: loops, skills });
      return true;
    }
    if (pathname === '/api/mobile/talents' && req.method === 'POST') {
      const b = JSON.parse((await body(req)).toString() || '{}');
      const t = b.talent as Partial<Loop> | undefined;
      if (!t) { send(res, { ok: false, error: 'talent required' }); return true; }
      const isNew = !t.id;
      const id = String(t.id || (t.name || 'talent').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `talent-${Date.now()}`);
      let skill = String(t.skill || '');
      if (isNew && !skill) skill = scaffoldSkill(id, String(t.name || id), String(t.description || ''));
      if (skill && !allowedSkillPath(skill)) { send(res, { ok: false, error: 'skill path outside allowed roots' }); return true; }
      if (isNew && skill && !fs.existsSync(skill)) skill = scaffoldSkill(id, String(t.name || id), String(t.description || ''));
      if (typeof b.skillContent === 'string' && skill) {
        try { fs.mkdirSync(path.dirname(skill), { recursive: true }); fs.writeFileSync(skill, b.skillContent, 'utf-8'); }
        catch (err) { send(res, { ok: false, error: 'skill write failed: ' + String(err) }); return true; }
      }
      const next: Loop = {
        id,
        name: String(t.name || 'New talent'),
        description: String(t.description || ''),
        goal: String(t.goal || ''),
        skill,
        intervalMin: Math.max(0, Number(t.intervalMin) || 0),
        intervalMaxMin: t.intervalMaxMin ? Math.max(Number(t.intervalMin) || 1, Number(t.intervalMaxMin)) : undefined,
        enabled: t.enabled !== false,
      };
      saveLoops([...loops.filter((l) => l.id !== id), next]);
      send(res, { ok: true, talents: loops, talent: next });
      return true;
    }
    if (pathname === '/api/mobile/talents' && req.method === 'DELETE') {
      const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
      saveLoops(loops.filter((l) => l.id !== id));
      send(res, { ok: true, talents: loops });
      return true;
    }
    if (pathname === '/api/mobile/skill' && req.method === 'GET') {
      const p = new URL(req.url, 'http://x').searchParams.get('path') || '';
      if (!allowedSkillPath(p)) { send(res, { ok: false, error: 'path not allowed' }); return true; }
      try { send(res, { ok: true, path: p, content: fs.readFileSync(p, 'utf-8') }); }
      catch (err) { send(res, { ok: false, error: String(err) }); }
      return true;
    }
    if (pathname === '/api/mobile/skill' && req.method === 'PUT') {
      const b = JSON.parse((await body(req)).toString() || '{}');
      const p = String(b.path || '');
      if (!allowedSkillPath(p)) { send(res, { ok: false, error: 'path not allowed' }); return true; }
      try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, String(b.content ?? ''), 'utf-8'); send(res, { ok: true }); }
      catch (err) { send(res, { ok: false, error: String(err) }); }
      return true;
    }
    if (pathname === '/api/mobile/toggle' && req.method === 'POST') {
      const b = JSON.parse((await body(req)).toString() || '{}') as { enabled?: boolean };
      state.enabled = b.enabled === true;
      save();
      if (state.enabled) void loop();
      else void restoreKeyboard();
      send(res, { ok: true, enabled: state.enabled });
      return true;
    }
    if (pathname === '/api/mobile/frame' && req.method === 'GET') {
      const img = await frame();
      if (!img) { res.writeHead(503); res.end('no frame'); return true; }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
      res.end(img);
      return true;
    }
    res.writeHead(404); res.end('not found');
    return true;
  } catch (err) {
    res.writeHead(500); res.end(String(err));
    return true;
  }
}

export function initMobile(): void {
  loops = readLoops();
  if (state.enabled) void loop();
  logger.info({ model: state.model, loops: loops.length }, 'mobile: initialized');
}
