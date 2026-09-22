/**
 * Ops model — the ONE model choice for heavy utility tooling and external
 * integrations: the components Warden connects things to, not the chat
 * seats. Today: Alpha Stack analysis runs + MARM's concept-graph topic
 * model. Future heavy tools should read this same row instead of growing
 * their own model pickers.
 *
 * Stored in router_state 'ops:model' (dashboard Settings "Ops model" row).
 * getOpsModel() is the read side for host components. Components that DON'T
 * read router_state (separate processes with their own config — alpha stack
 * and MARM today) get the value pushed to them by propagateOpsModel() on
 * settings save:
 *
 *   - Alpha Stack: trading/.alpha-stack/state.json settings.model +
 *     trading/webapp/config.json default_model (via scripts/alpha-model.mjs).
 *     Skipped when trading/ isn't present — the trading stack is excluded
 *     from fresh installs by install.sh.
 *   - MARM: rewrite the systemd drop-in Environment=MARM_TOPIC_MODEL
 *     (Linux) or the launchd plist's EnvironmentVariables (macOS), then
 *     restart the marm-memory service.
 *
 * Every propagation step is best-effort: failures are logged, never thrown
 * back into a settings save. A blank ops model clears the router_state row
 * only — downstream configs are left as-is (no implicit change on unset).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { logger } from './logger.js';
import { getRouterState } from './db.js';

/** The ops model as configured in the dashboard ('' = unset). */
export function getOpsModel(): string {
  return (getRouterState('ops:model') || '').replace(/^local:/, '').trim();
}


const PROPAGATE_TIMEOUT_MS = 15_000;

function run(cmd: string, args: string[], label: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: PROPAGATE_TIMEOUT_MS }, (err, _stdout, stderr) => {
      if (err) {
        logger.warn({ err: err.message, stderr: String(stderr).slice(0, 300), label }, 'ops-model propagation step failed');
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

/** Push the ops model into the Alpha Stack's own config files. */
async function propagateToAlphaStack(model: string): Promise<void> {
  // process.cwd() is the install dir (WorkingDirectory in the unit / REPO in
  // the macOS plist) — the trading stack sits there when it exists at all.
  const tradingDir = path.join(process.cwd(), 'trading');
  const script = path.join(process.cwd(), 'scripts', 'alpha-model.mjs');
  if (!fs.existsSync(path.join(tradingDir, '.alpha-stack', 'state.json'))) return;
  if (!fs.existsSync(script)) return;
  const ok = await run(process.execPath, [script, tradingDir, model], 'alpha-stack');
  if (ok) logger.info({ model }, 'ops model → alpha-stack settings.model + webapp default_model');
}

/** Rebuild the MARM topic-model config for this OS and restart the service. */
async function propagateToMarm(model: string): Promise<void> {
  const platform = os.platform();
  const home = os.homedir();
  if (platform === 'darwin') {
    // launchd: the plist carries MARM_TOPIC_MODEL in EnvironmentVariables.
    const plist = path.join(home, 'Library', 'LaunchAgents', 'com.warden.marm.plist');
    if (!fs.existsSync(plist)) return;
    try {
      let xml = fs.readFileSync(plist, 'utf8');
      if (!xml.includes('<key>MARM_TOPIC_MODEL</key>')) return; // old plist; installer owns upgrades
      xml = xml.replace(
        /<key>MARM_TOPIC_MODEL<\/key>\s*<string>[^<]*<\/string>/,
        `<key>MARM_TOPIC_MODEL</key><string>${model}</string>`,
      );
      fs.writeFileSync(plist, xml);
    } catch (err) {
      logger.warn({ err: String(err) }, 'ops-model: could not rewrite com.warden.marm.plist');
      return;
    }
    await run('launchctl', ['kickstart', '-k', `gui/${process.getuid!()}/com.warden.marm`], 'marm-kickstart');
    logger.info({ model }, 'ops model → MARM topic model (launchd plist + kickstart)');
    return;
  }
  // Linux: systemd --user drop-in holds Environment=MARM_TOPIC_MODEL.
  if (!fs.existsSync(path.join(home, '.config', 'systemd', 'user', 'marm-memory.service'))) return;
  const dropDir = path.join(home, '.config', 'systemd', 'user', 'marm-memory.service.d');
  try {
    fs.mkdirSync(dropDir, { recursive: true });
    fs.writeFileSync(
      path.join(dropDir, 'topic-model.conf'),
      `[Service]\nEnvironment=MARM_TOPIC_MODEL=${model}\n`,
    );
  } catch (err) {
    logger.warn({ err: String(err) }, 'ops-model: could not write marm topic-model drop-in');
    return;
  }
  // Warden itself runs as a user service, so XDG_RUNTIME_DIR is inherited for
  // the systemctl --user call; pass it explicitly anyway for manual runs.
  const env = { ...process.env, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid!()}` };
  const reloaded = await new Promise<boolean>((resolve) => {
    execFile('systemctl', ['--user', 'daemon-reload'], { timeout: PROPAGATE_TIMEOUT_MS, env }, () => resolve(true));
  });
  if (!reloaded) return;
  await new Promise<void>((resolve) => {
    execFile('systemctl', ['--user', 'restart', 'marm-memory.service'], { timeout: PROPAGATE_TIMEOUT_MS, env }, (err) => {
      if (err) logger.warn({ err: err.message }, 'ops-model: marm-memory restart failed (drop-in applied; picks up on next start)');
      resolve();
    });
  });
  logger.info({ model }, 'ops model → MARM topic model (drop-in + service restart)');
}

/** Best-effort propagation to both consumers. Never throws. */
export function propagateOpsModel(model: string): void {
  const m = model.trim().replace(/^local:/, '');
  if (!m) return; // blank clears router_state only; downstream untouched
  propagateToAlphaStack(m).catch((err) => logger.warn({ err: String(err) }, 'ops-model alpha propagation failed'));
  propagateToMarm(m).catch((err) => logger.warn({ err: String(err) }, 'ops-model marm propagation failed'));
}
