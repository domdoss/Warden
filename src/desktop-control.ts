import { execFile } from 'child_process';
import { promisify } from 'util';

const pexecFile = promisify(execFile);

export type SessionType = 'wayland' | 'x11' | 'unknown';

export type MouseButton = 'left' | 'right' | 'middle';

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WindowInfo {
  id: string;
  title: string;
  app: string;
}

/** Detect the current desktop session type from the XDG_SESSION_TYPE env var. */
export function detectSession(): SessionType {
  const t = process.env.XDG_SESSION_TYPE;
  if (t === 'wayland') return 'wayland';
  if (t === 'x11') return 'x11';
  return 'unknown';
}

function requireSession(): SessionType {
  const s = detectSession();
  if (s === 'unknown') {
    throw new Error(
      'desktop-control: unknown session type (set XDG_SESSION_TYPE=wayland|x11)',
    );
  }
  return s;
}

// --- ydotool button codes (libinput button codes as hex) ---
// 0xC0 = left, 0xC1 = right, 0xC2 = middle (BTN_LEFT/BTN_RIGHT/BTN_MIDDLE).
const YDOTOOL_BUTTON: Record<MouseButton, string> = {
  left: '0xC0',
  right: '0xC1',
  middle: '0xC2',
};

// xdotool button numbers: 1=left, 2=middle, 3=right.
const XDOTOOL_BUTTON: Record<MouseButton, string> = {
  left: '1',
  middle: '2',
  right: '3',
};

export async function mouseMove(x: number, y: number): Promise<void> {
  const s = requireSession();
  if (s === 'wayland') {
    await pexecFile('ydotool', ['move', '--abs', String(x), String(y)]);
  } else {
    await pexecFile('xdotool', ['mousemove', String(x), String(y)]);
  }
}

export async function mouseClick(button: MouseButton = 'left'): Promise<void> {
  const s = requireSession();
  if (s === 'wayland') {
    await pexecFile('ydotool', ['click', YDOTOOL_BUTTON[button]]);
  } else {
    await pexecFile('xdotool', ['click', XDOTOOL_BUTTON[button]]);
  }
}

/**
 * Scroll by `amount` clicks. Positive = down, negative = up.
 * ydotool: emit wheel button clicks (BTN_WHEEL is not directly clickable;
 * we use `click` with the high-res wheel codes 0x10/0x11 via `ydotool click`).
 * xdotool: button 4 = wheel up, 5 = wheel down.
 */
export async function mouseScroll(amount: number): Promise<void> {
  const s = requireSession();
  const abs = Math.abs(amount);
  if (abs === 0) return;
  if (s === 'wayland') {
    // 0x10 = wheel down, 0x11 = wheel up (libinput BTN_FORWARD / BTN_BACK used
    // as a stand-in — ydotool maps these to scroll events on most compositors).
    const code = amount > 0 ? '0x10' : '0x11';
    const args: string[] = ['click'];
    for (let i = 0; i < abs; i++) args.push(code);
    await pexecFile('ydotool', args);
  } else {
    const btn = amount > 0 ? '5' : '4';
    const args: string[] = ['click'];
    for (let i = 0; i < abs; i++) args.push(btn);
    await pexecFile('xdotool', args);
  }
}

export async function keyboardType(text: string): Promise<void> {
  const s = requireSession();
  if (s === 'wayland') {
    await pexecFile('wtype', [text]);
  } else {
    await pexecFile('xdotool', ['type', text]);
  }
}

/**
 * Press a single key, optionally with modifiers held.
 * `key` should be a libinput key name for Wayland (e.g. "Return", "Escape",
 * "a") or an xdotool key name for X11 (e.g. "Return", "Escape", "a").
 * `mods` are lower-case modifier names: "ctrl", "shift", "alt", "super".
 */
export async function keyboardKey(key: string, mods: string[] = []): Promise<void> {
  const s = requireSession();
  if (s === 'wayland') {
    // wtype: -M <mod> for each held modifier, then -k <key>.
    const args: string[] = [];
    for (const m of mods) {
      args.push('-M', m);
    }
    args.push('-k', key);
    await pexecFile('wtype', args);
  } else {
    const combo = mods.length > 0 ? `${mods.join('+')}+${key}` : key;
    await pexecFile('xdotool', ['key', combo]);
  }
}

/**
 * Capture a screenshot, optionally cropped to `region`. Returns a PNG Buffer.
 * Wayland: `grim [-g "x,y wxh"] -` writes PNG to stdout.
 * X11: `scrot [-a x,y,w,h] -` writes PNG to stdout.
 */
export async function screenshot(region?: Region): Promise<Buffer> {
  const s = requireSession();
  if (s === 'wayland') {
    const args = region
      ? ['-g', `${region.x},${region.y} ${region.w}x${region.h}`, '-']
      : ['-'];
    const { stdout } = await pexecFile('grim', args, { encoding: 'buffer' });
    return stdout as unknown as Buffer;
  } else {
    const args = region
      ? ['-a', `${region.x},${region.y},${region.w},${region.h}`, '-']
      : ['-'];
    const { stdout } = await pexecFile('scrot', args, { encoding: 'buffer' });
    return stdout as unknown as Buffer;
  }
}

/**
 * List all open windows. Tries `hyprctl clients -j` first on Wayland and falls
 * back to `swaymsg -t get_tree` if hyprctl is not available. On X11 uses
 * `wmctrl -l`.
 */
export async function windowList(): Promise<WindowInfo[]> {
  const s = requireSession();
  if (s === 'wayland') {
    try {
      const { stdout } = await pexecFile('hyprctl', ['clients', '-j']);
      return parseHyprctlClients(stdout);
    } catch (e) {
      // Fall back to swaymsg.
      const { stdout } = await pexecFile('swaymsg', ['-t', 'get_tree']);
      return parseSwayTree(stdout);
    }
  } else {
    const { stdout } = await pexecFile('wmctrl', ['-l']);
    return parseWmctrl(stdout);
  }
}

interface HyprctlClient {
  address?: string;
  title?: string;
  class?: string;
}

function parseHyprctlClients(stdout: string): WindowInfo[] {
  const clients: HyprctlClient[] = JSON.parse(stdout);
  return clients
    .filter((c) => c.address)
    .map((c) => ({
      id: c.address as string,
      title: c.title ?? '',
      app: c.class ?? '',
    }));
}

interface SwayNode {
  id?: number;
  name?: string;
  app_id?: string;
  window_properties?: { class?: string; title?: string };
  nodes?: SwayNode[];
  floating_nodes?: SwayNode[];
}

function parseSwayTree(stdout: string): WindowInfo[] {
  const root: SwayNode = JSON.parse(stdout);
  const out: WindowInfo[] = [];
  const walk = (n: SwayNode): void => {
    if (n.name && (n.app_id || n.window_properties?.class)) {
      out.push({
        id: String(n.id),
        title: n.name,
        app: n.app_id ?? n.window_properties?.class ?? '',
      });
    }
    for (const c of n.nodes ?? []) walk(c);
    for (const c of n.floating_nodes ?? []) walk(c);
  };
  walk(root);
  return out;
}

/**
 * wmctrl -l output format:
 * `0x00800004  0 Dominic Terminal`
 * Columns: id, desktop, "<host> <title>" (the remainder is the host-prefixed
 * window title). We keep the full remainder as both title and app — wmctrl
 * does not expose the application class.
 */
function parseWmctrl(stdout: string): WindowInfo[] {
  const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const m = /^(\S+)\s+\d+\s+(.*)$/.exec(line);
    if (!m) return { id: '', title: line, app: line };
    const id = m[1];
    const title = m[2];
    return { id, title, app: title };
  });
}

export async function windowFocus(id: string): Promise<void> {
  const s = requireSession();
  if (s === 'wayland') {
    await pexecFile('hyprctl', [
      'dispatch',
      'focuswindow',
      `address:${id}`,
    ]);
  } else {
    await pexecFile('wmctrl', ['-i', '-a', id]);
  }
}

export async function windowClose(id: string): Promise<void> {
  const s = requireSession();
  if (s === 'wayland') {
    await pexecFile('hyprctl', [
      'dispatch',
      'closewindow',
      `address:${id}`,
    ]);
  } else {
    await pexecFile('wmctrl', ['-i', '-c', id]);
  }
}