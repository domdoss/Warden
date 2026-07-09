import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const pexecFile = promisify(execFile);

export type NotifyUrgency = 'low' | 'normal' | 'critical';

export interface KwinWindow {
  uuid: string;
  caption: string;
  resourceClass: string;
  desktop: number;
}

export function isPlasma(): boolean {
  if (process.env.KDE_SESSION_VERSION) return true;
  const desktop = process.env.XDG_CURRENT_DESKTOP ?? '';
  return desktop.split(':').some((s) => s.toUpperCase() === 'KDE');
}

let cachedQdbus: string | null = null;

async function qdbusBin(): Promise<string> {
  if (cachedQdbus) return cachedQdbus;
  for (const bin of ['qdbus6', 'qdbus-qt6', 'qdbus']) {
    try {
      await pexecFile(bin, ['--version']);
      cachedQdbus = bin;
      return bin;
    } catch {
      // try next
    }
  }
  throw new Error(
    'desktop-plasma: qdbus not found — install qt6-tools (Arch: pacman -S qt6-tools)',
  );
}

async function qdbus(...args: string[]): Promise<string> {
  const bin = await qdbusBin();
  const { stdout } = await pexecFile(bin, args);
  return stdout.replace(/\n$/, '');
}

/**
 * Show a desktop notification via the org.freedesktop.Notifications spec.
 * Uses notify-send because it handles action buttons, icons, and hint parsing
 * that we'd otherwise have to hand-roll over D-Bus.
 */
export async function notify(
  title: string,
  body: string,
  urgency: NotifyUrgency = 'normal',
): Promise<void> {
  await pexecFile('notify-send', ['-u', urgency, '--', title, body]);
}

/**
 * Open a URL or local file with the user's default handler. Restricted to
 * http/https/file schemes to prevent an LLM-generated `javascript:` or shell
 * command sneaking through the same entrypoint.
 */
export async function openUrl(url: string): Promise<void> {
  if (!/^(https?|file):\/\//.test(url)) {
    throw new Error('openUrl: only http/https/file URLs allowed');
  }
  await pexecFile('xdg-open', [url]);
}

export async function clipboardRead(): Promise<string> {
  return qdbus('org.kde.klipper', '/klipper', 'getClipboardContents');
}

export async function clipboardWrite(text: string): Promise<void> {
  await qdbus('org.kde.klipper', '/klipper', 'setClipboardContents', text);
}

export async function currentActivity(): Promise<string> {
  return qdbus(
    'org.kde.ActivityManager',
    '/ActivityManager/Activities',
    'CurrentActivity',
  );
}

/**
 * List KWin-managed windows via a one-shot KWin script. Plasma has no direct
 * D-Bus method to enumerate clients; the supported path is to load a tiny JS
 * script into KWin, have it print client info, then read it back from the
 * journal. Cheap but has one gotcha: the print output ends up in the journal
 * of the current user, so this is best-effort and may return [] on systems
 * where journalctl is unavailable to the current user.
 */
export async function kwinWindows(): Promise<KwinWindow[]> {
  const script = `
    const cs = workspace.stackingOrder || workspace.windowList();
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (!c || !c.normalWindow) continue;
      print(JSON.stringify({
        uuid: String(c.internalId || ''),
        caption: String(c.caption || ''),
        resourceClass: String(c.resourceClass || ''),
        desktop: Number(c.desktop || 0),
      }));
    }
  `.trim();

  const scriptPath = join(tmpdir(), `dockbox-kwin-${process.pid}-${Date.now()}.js`);
  await writeFile(scriptPath, script);
  try {
    const scriptId = await qdbus(
      'org.kde.KWin',
      '/Scripting',
      'org.kde.kwin.Scripting.loadScript',
      scriptPath,
    );
    await qdbus('org.kde.KWin', `/${scriptId}`, 'run');
    await qdbus('org.kde.KWin', `/${scriptId}`, 'stop');
  } finally {
    await unlink(scriptPath).catch(() => {});
  }

  const { stdout } = await pexecFile('journalctl', [
    '--user',
    '-t',
    'KWin',
    '-o',
    'cat',
    '--since',
    '10 seconds ago',
  ]);
  const out: KwinWindow[] = [];
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      out.push(JSON.parse(t) as KwinWindow);
    } catch {
      // non-JSON print line
    }
  }
  return out;
}
