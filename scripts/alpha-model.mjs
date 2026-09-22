#!/usr/bin/env node
/**
 * Set the Alpha Stack default (ops) model from the installer prompt or the
 * Warden dashboard's Ops model setting.
 *
 * Two paths, in order:
 *
 *   1. LIVE API (preferred): GET /api/state → set settings.model → POST the
 *      FULL state back. Going through the running webapp updates its
 *      in-memory copy AND writes the file, so a later webapp saveState call
 *      can't undo our change (a raw file patch while it runs gets clobbered).
 *      The POST must carry the full state — the handler rebuilds from
 *      defaults + body keys, so a partial body would reset portfolio/watchlist.
 *
 *   2. FILE PATCH (fallback, webapp down): patch state.json settings.model
 *      and webapp/config.json default_model directly.
 *
 * Any Ollama tag — local (granite4.2:30b) or cloud (kimi-k3:cloud). The tag
 * is NOT validated against `ollama list`: models are often pulled after the
 * install, and a bad tag fails loudly at run time.
 *
 * Usage: node scripts/alpha-model.mjs <tradingDir> <model>
 * Env:   ALPHA_STACK_URL — webapp base URL (default http://127.0.0.1:8765)
 */
import fs from 'fs';
import path from 'path';

const [tradingDir, model] = process.argv.slice(2);
if (!tradingDir || !model) {
  console.error('usage: alpha-model.mjs <tradingDir> <model>');
  process.exit(1);
}

const API = process.env.ALPHA_STACK_URL || 'http://127.0.0.1:8765';

async function viaApi() {
  const res = await fetch(`${API}/api/state`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`GET /api/state → ${res.status}`);
  const state = await res.json();
  if (!state || typeof state !== 'object') throw new Error('unexpected /api/state payload');
  state.settings = { ...(state.settings || {}), model };
  const post = await fetch(`${API}/api/state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(state),
    signal: AbortSignal.timeout(5000),
  });
  if (!post.ok) throw new Error(`POST /api/state → ${post.status}`);
}

function patchJson(file, apply) {
  if (!fs.existsSync(file)) return false;
  const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  apply(obj);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
  return true;
}

let done = '';
try {
  await viaApi();
  done = 'api';
} catch (err) {
  console.error(`alpha-model: webapp API path failed (${err.message}); falling back to file patch`);
  let wrote = 0;
  try { if (patchJson(path.join(tradingDir, '.alpha-stack', 'state.json'), o => { o.settings = o.settings || {}; o.settings.model = model; })) wrote++; } catch (e) { console.error(`alpha-model: state.json: ${e.message}`); }
  try { if (patchJson(path.join(tradingDir, 'webapp', 'config.json'), o => { o.default_model = model; })) wrote++; } catch (e) { console.error(`alpha-model: config.json: ${e.message}`); }
  if (wrote === 0) {
    console.error('alpha-model: no alpha-stack config files found — is the stack initialized?');
    process.exit(1);
  }
  done = 'files';
}

// webapp/config.json default_model always gets patched (the webapp doesn't
// write it itself, so no race) — even when the API path handled state.json.
if (done === 'api') {
  try { patchJson(path.join(tradingDir, 'webapp', 'config.json'), o => { o.default_model = model; }); } catch { /* optional */ }
}
console.log(`alpha-model: ${model} (${done})`);
