#!/usr/bin/env node
/**
 * Register the MARM stdio server in data/mcp-servers.json (upsert).
 *
 * Called by install.sh after installing marm-mcp-server, with the absolute
 * binary path as argv[2]. Using the absolute path matters: systemd --user
 * services get a minimal PATH that can miss ~/.local/bin, and the seeded
 * default entry is PATH-relative ("marm-memory").
 *
 * Upsert semantics:
 *   - File missing → created with the marm entry (plus nothing else).
 *   - Entry missing → appended, enabled.
 *   - Entry present → command/args/env/transport corrected, enabled forced
 *     true (running install.sh with MARM on is the opt-in), extra user fields
 *     (notes/descriptions) preserved.
 * To opt out of MARM entirely, run install.sh with INSTALL_MARM=0 — this
 * script is never invoked and any existing entry is left alone.
 *
 * Usage: node scripts/register-marm.mjs /absolute/path/to/marm-memory
 */
import fs from 'fs';
import path from 'path';

const bin = process.argv[2];
if (!bin || !fs.existsSync(bin)) {
  console.error(`register-marm: binary not found: ${bin ?? '(no path given)'}`);
  process.exit(1);
}

const cfgPath = process.env.MCP_SERVERS_CONFIG || path.join(process.cwd(), 'data', 'mcp-servers.json');

let list = [];
try {
  const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  if (Array.isArray(parsed)) list = parsed;
} catch { /* missing or malformed → start fresh */ }

const entry = {
  name: 'marm',
  command: bin,
  args: ['stdio'],
  transport: 'stdio',
  enabled: true,
  // The per-turn stdio child must not build the concept graph — the
  // long-lived HTTP service (marm-memory.service on 127.0.0.1:8001) owns it;
  // both share concept_build_lock in marm_memory.db and fight otherwise.
  env: { CONCEPT_AUTO_INDEX: 'false' },
};

const i = list.findIndex((s) => s && s.name === 'marm');
if (i >= 0) list[i] = { ...list[i], ...entry };
else list.push({
  ...entry,
  description:
    'MARM long-term memory: hybrid BM25+semantic recall (marm_smart_recall) + concept graph. The HTTP server for memory writeback runs separately (marm-memory.service) on 127.0.0.1:8001.',
});

fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
const tmp = `${cfgPath}.${process.pid}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
fs.renameSync(tmp, cfgPath);
console.log(`register-marm: ${i >= 0 ? 'updated' : 'added'} marm entry in ${cfgPath}`);
