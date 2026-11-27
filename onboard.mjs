import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();
const APP = process.env.APP || ROOT;
const START_PORT = Number(process.env.WARDEN_ONBOARD_PORT || 3201);
const STATE = { phase: 'idle', log: [], ready: false, error: '', appPort: 3200 };
const ENV_DIR = path.join(ROOT, 'data', 'env');
const ENV_FILE = path.join(ENV_DIR, 'env');
const MARKER = path.join(ROOT, 'data', '.onboarded');

function logLine(s) {
  STATE.log.push(String(s).replace(/\s+$/, ''));
  if (STATE.log.length > 300) STATE.log.splice(0, STATE.log.length - 300);
}

function writeEnv(body) {
  fs.mkdirSync(ENV_DIR, { recursive: true });
  const home = body.workspaceRoot?.trim() || path.join(os.homedir(), 'Warden');
  const lines = [
    '# Warden configuration — created by the first-run setup',
    'ASSISTANT_NAME=Warden',
    `TZ=${body.timezone || 'America/Vancouver'}`,
    `OLLAMA_URL=${body.ollamaUrl?.trim() || 'http://127.0.0.1:11434'}`,
    `WORKSPACE_ROOT=${home}`,
    `STATUS_PORT=${STATE.appPort}`,
    body.telegramToken?.trim() ? `TELEGRAM_BOT_TOKEN=${body.telegramToken.trim()}` : '#TELEGRAM_BOT_TOKEN=',
    body.tailscale ? 'WARDEN_TAILSCALE=1' : '#WARDEN_TAILSCALE=0',
    body.imagegenModels?.trim() ? `WARDEN_IMAGEGEN_MODELS=${body.imagegenModels.trim()}` : '#WARDEN_IMAGEGEN_MODELS=',
    '',
  ];
  fs.writeFileSync(ENV_FILE, lines.join('\n'), { mode: 0o600 });
  fs.mkdirSync(path.join(home, 'groups', 'main'), { recursive: true });
  fs.writeFileSync(MARKER, new Date().toISOString() + '\n');
}

function provisionScript() {
  const local = path.join(ROOT, 'provision-local.sh');
  if (fs.existsSync(local)) return { cmd: 'bash', args: [local, '--base'] };
  const appScript = path.join(APP, 'provision.sh');
  if (fs.existsSync(appScript)) return { cmd: 'bash', args: [appScript, '--base'] };
  return null;
}

function runProvision(body, done) {
  const script = provisionScript();
  if (!script) { logLine('No provisioning script found; skipping.'); return done(); }
  STATE.phase = 'provisioning';
  logLine('Installing required software…');
  const env = {
    ...process.env,
    APP,
    RUN: ROOT,
    WARDEN_RUN_DIR: ROOT,
    WARDEN_PROVISION_MARM: body.marm === false ? '0' : '1',
    WARDEN_PROVISION_BROWSER: body.browser === false ? '0' : '1',
  };
  const child = spawn(script.cmd, script.args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach(logLine));
  child.stderr.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach(logLine));
  child.on('error', (e) => { STATE.error = e.message; logLine('Provisioning failed: ' + e.message); });
  child.on('close', (code) => {
    if (code === 0) logLine('Provisioning complete.');
    else { STATE.error = 'Provisioning exited ' + code; logLine(STATE.error); }
    done();
  });
}

function startApp() {
  STATE.phase = 'starting';
  logLine('Starting Warden…');
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: ROOT,
    env: { ...process.env },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  let tries = 0;
  const timer = setInterval(async () => {
    tries++;
    try {
      const res = await fetch(`http://127.0.0.1:${STATE.appPort}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        clearInterval(timer);
        STATE.phase = 'ready';
        STATE.ready = true;
        logLine('Warden is ready.');
      }
    } catch { /* keep waiting */ }
    if (tries > 120) { clearInterval(timer); STATE.phase = 'error'; STATE.error = 'Warden did not start.'; logLine(STATE.error); }
  }, 1000);
}

const PAGE = (port) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Warden setup</title><style>
*{box-sizing:border-box}body{margin:0;background:#0e1013;color:#eef3fd;font:15px/1.55 system-ui,-apple-system,sans-serif}
.wrap{max-width:720px;margin:48px auto;padding:0 22px}.brand{font-family:ui-monospace,monospace;letter-spacing:.18em;color:#ff5c1a;font-size:12px;text-transform:uppercase}
h1{font-size:30px;margin:10px 0 6px}.sub{color:#9fb0cd;margin-bottom:26px}
.card{background:#151a22;border:1px solid #263041;border-radius:14px;padding:20px;margin-bottom:14px}
h3{margin:0 0 4px;font-size:15px}.hint{color:#7f8ca3;font-size:12px;margin-bottom:12px}
label{display:block;font-size:12px;color:#b7c3d6;margin:12px 0 5px}
input[type=text],input[type=password],input[type=url]{width:100%;background:#0b0f16;border:1px solid #2b3648;color:#eef3fd;border-radius:9px;padding:11px 12px;font:inherit}
input:focus{outline:none;border-color:#ff5c1a}.row{display:flex;gap:10px;flex-wrap:wrap}.row>div{flex:1;min-width:220px}
.check{display:flex;align-items:flex-start;gap:9px;margin:12px 0;font-size:13px;color:#cfd8e6}.check input{margin-top:3px;accent-color:#ff5c1a}
button{margin-top:18px;width:100%;padding:14px;border:0;border-radius:10px;background:#ff5c1a;color:#0e1013;font-weight:800;font-size:15px;cursor:pointer}
button:disabled{opacity:.5;cursor:default}.log{background:#0b0f16;border:1px solid #263041;border-radius:10px;padding:12px;font:11px/1.5 ui-monospace,monospace;color:#9fb0cd;white-space:pre-wrap;max-height:220px;overflow:auto;display:none}
.ok{color:#49e08b}.err{color:#ff6676}.skip{color:#7f8ca3}
</style></head><body><div class="wrap">
<div class="brand">Warden · first run</div><h1>Let's get you set up.</h1>
<p class="sub">A few choices, then Warden installs what it needs and starts. Everything can be changed later.</p>
<form id="f">
  <div class="card"><h3>Where Warden lives</h3><div class="hint">Its home folder for files, notes and uploads.</div>
    <label>Home folder</label><input type="text" id="workspaceRoot" placeholder="~/Warden">
    <label>Ollama URL</label><input type="text" id="ollamaUrl" value="http://127.0.0.1:11434">
  </div>
  <div class="card"><h3>Memory</h3><div class="hint">MARM gives Warden long-term semantic recall. Installed from GitHub as part of setup.</div>
    <label class="check"><input type="checkbox" id="marm" checked> Install MARM memory</label>
    <label class="check"><input type="checkbox" id="browser" checked> Install browser stack (Chrome MCP + Playwright)</label>
  </div>
  <div class="card"><h3>Optional connections</h3><div class="hint">Leave blank to skip and add later in Settings.</div>
    <label>Telegram bot token</label><input type="password" id="telegramToken" placeholder="123456:ABC… (optional)">
    <label class="check"><input type="checkbox" id="tailscale"> Use Tailscale (friends/BBS mesh)</label>
    <label>Image model folder (optional)</label><input type="text" id="imagegenModels" placeholder="/path/to/imagegen/models">
  </div>
  <button id="go" type="submit">Set up Warden</button>
</form>
<div class="log" id="log"></div>
</div><script>
const $ = (id) => document.getElementById(id);
$('workspaceRoot').placeholder = '~/' + 'Warden';
$('f').onsubmit = async (e) => {
  e.preventDefault();
  $('go').disabled = true; $('go').textContent = 'Setting up…'; $('log').style.display = 'block';
  const body = {
    workspaceRoot: $('workspaceRoot').value,
    ollamaUrl: $('ollamaUrl').value,
    telegramToken: $('telegramToken').value,
    imagegenModels: $('imagegenModels').value,
    marm: $('marm').checked,
    browser: $('browser').checked,
    tailscale: $('tailscale').checked,
  };
  await fetch('/api/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const poll = setInterval(async () => {
    try {
      const s = await (await fetch('/api/status')).json();
      $('log').textContent = (s.log || []).join('\\n');
      $('log').scrollTop = $('log').scrollHeight;
      if (s.ready) { clearInterval(poll); location.href = 'http://127.0.0.1:' + s.appPort + '/'; }
      if (s.phase === 'error') { clearInterval(poll); $('go').disabled = false; $('go').textContent = 'Retry'; $('go').classList.add('err'); }
    } catch {}
  }, 1000);
};
</script></body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${START_PORT}`);
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(PAGE(START_PORT));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(STATE));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/setup') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 200000) req.destroy(); });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch {}
      try {
        writeEnv(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        runProvision(body, () => startApp());
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});

function listen(port) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && port < START_PORT + 8) listen(port + 1);
    else { console.error(e.message); process.exit(1); }
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`Warden setup: ${url}`);
    try { spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref(); } catch {}
  });
}

listen(START_PORT);
