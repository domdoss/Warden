import fs from 'fs';
import { execSync } from 'child_process';
import { registry } from '../tool-registry.js';
import { log } from '../ipc-helpers.js';

const DISPLAY_ENV = {
    DISPLAY: process.env.DISPLAY || ':1',
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || '/run/user/1000',
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || 'unix:path=/run/user/1000/bus',
};

function run(cmd: string, extraEnv: Record<string, string> = {}): string {
    return execSync(cmd, {
        encoding: 'utf-8',
        timeout: 15000,
        env: { ...process.env, ...DISPLAY_ENV, ...extraEnv },
    }).trim();
}

registry.register({
    name: 'desktop_screenshot',
    description: 'Take a screenshot of the full desktop. The image is loaded into your vision context immediately — you can see and describe it in your next response. Returns the file path and native resolution.',
    schema: {
        type: 'object',
        properties: {
            window_title: { type: 'string', description: 'Optional: capture a specific window by title substring instead of the full desktop.' },
        },
        required: [],
    },
    handler: async (args) => {
        const ts = Date.now();
        const outPath = `/tmp/prometheus-desktop-${ts}.png`;

        try {
            if (args.window_title) {
                try { run(`xdotool search --name "${args.window_title}" windowactivate --sync`); } catch { /* best-effort */ }
                run(`spectacle -b -n -a -o "${outPath}"`);
            } else {
                run(`spectacle -b -n -f -o "${outPath}"`);
            }
        } catch (err: any) {
            return `Error taking screenshot: ${err.message}`;
        }

        if (!fs.existsSync(outPath)) {
            return 'Error: screenshot file was not created.';
        }

        let width = 0, height = 0;
        try {
            const info = run(`identify -format "%wx%h" "${outPath}"`);
            [width, height] = info.split('x').map(Number);
        } catch { /* unknown size */ }

        try {
            const buf = fs.readFileSync(outPath);
            if (!(globalThis as any)._pendingImages) (globalThis as any)._pendingImages = [];
            (globalThis as any)._pendingImages.push(buf.toString('base64'));
            log(`desktop_screenshot: queued ${outPath} (${width}x${height}) for vision`);
        } catch (err: any) {
            return `Screenshot saved to ${outPath} but failed to load for vision: ${err.message}`;
        }

        const sizeDesc = width && height ? ` (${width}×${height}px — these are the exact screen coordinates)` : '';
        return `Screenshot taken${sizeDesc}. The image is now in your vision context — you can see the screen and identify element positions. Use desktop_click(x, y) with coordinates from the image to interact.`;
    },
    toolset: 'terminal',
    tier: 'public',
});

registry.register({
    name: 'desktop_click',
    description: 'Click at absolute screen coordinates. Use coordinates from a desktop_screenshot image.',
    schema: {
        type: 'object',
        properties: {
            x: { type: 'number', description: 'X coordinate (pixels from left)' },
            y: { type: 'number', description: 'Y coordinate (pixels from top)' },
            button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button (default: left)' },
            double: { type: 'boolean', description: 'Double-click (default: false)' },
        },
        required: ['x', 'y'],
    },
    handler: async (args) => {
        const x = Math.round(args.x);
        const y = Math.round(args.y);
        const btn = args.button === 'right' ? 3 : args.button === 'middle' ? 2 : 1;
        const double_ = !!args.double;

        try {
            run(`xdotool mousemove --sync ${x} ${y} click ${btn}`);
            if (double_) run(`xdotool click ${btn}`);
            return `Clicked at (${x}, ${y})${double_ ? ' (double)' : ''}.`;
        } catch (err: any) {
            return `Error clicking at (${x}, ${y}): ${err.message}`;
        }
    },
    toolset: 'terminal',
    tier: 'public',
});

registry.register({
    name: 'desktop_type',
    description: 'Type text or send keyboard shortcuts on the desktop. Use for typing into focused fields or sending key combos like ctrl+c.',
    schema: {
        type: 'object',
        properties: {
            text: { type: 'string', description: 'Text to type. Cannot be used together with keys.' },
            keys: { type: 'string', description: 'Key combo to send, e.g. "ctrl+c", "Return", "alt+F4", "ctrl+shift+t". Cannot be used together with text.' },
            delay_ms: { type: 'number', description: 'Delay between keystrokes in ms (default 12). Increase for slow apps.' },
        },
        required: [],
    },
    handler: async (args) => {
        const delay = args.delay_ms ?? 12;

        if (args.keys) {
            try {
                run(`xdotool key --clearmodifiers "${args.keys}"`);
                return `Sent keys: ${args.keys}`;
            } catch (err: any) {
                return `Error sending keys "${args.keys}": ${err.message}`;
            }
        }

        if (args.text) {
            try {
                run(`xdotool type --clearmodifiers --delay ${delay} -- ${JSON.stringify(args.text)}`);
                return `Typed: ${args.text.slice(0, 80)}${args.text.length > 80 ? '…' : ''}`;
            } catch (err: any) {
                return `Error typing text: ${err.message}`;
            }
        }

        return 'Error: provide either text or keys.';
    },
    toolset: 'terminal',
    tier: 'public',
});
