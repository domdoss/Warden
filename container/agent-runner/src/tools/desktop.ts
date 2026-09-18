import { execSync } from 'child_process';
import { registry } from '../tool-registry.js';
import { log } from '../ipc-helpers.js';
import { writeCallbackAsync } from '../index.js';

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

/** Push a base64 image into the vision-context queue consumed after this tool call. */
function queueForVision(b64: string): void {
    if (!b64) return;
    if (!(globalThis as any)._pendingImages) (globalThis as any)._pendingImages = [];
    (globalThis as any)._pendingImages.push(b64);
}

registry.register({
    name: 'desktop_screenshot',
    description: 'Take a screenshot of the full desktop (or a window/region). The image is loaded into your vision context immediately — you can see it in your next response and use the pixel coordinates to drive desktop_click(x, y). Returns the native resolution. Use this to SEE a native desktop app (Stremio, a media player, a settings window) before clicking it; for web pages use browser_snapshot instead.',
    schema: {
        type: 'object',
        properties: {
            window_title: { type: 'string', description: 'Optional: capture a specific window by title substring instead of the full desktop.' },
            region: {
                type: 'object',
                description: 'Optional: capture a sub-rectangle in pixels.',
                properties: {
                    x: { type: 'number' }, y: { type: 'number' },
                    w: { type: 'number' }, h: { type: 'number' },
                },
            },
        },
        required: [],
    },
    handler: async (args) => {
        try {
            const res = await writeCallbackAsync('desktop_screenshot', args, 30000);
            if (!res || res.ok === false) {
                return `Error taking screenshot: ${res?.error || 'host callback failed'}`;
            }
            const b64 = typeof res.image === 'string' ? res.image : '';
            if (!b64) return `Error: host returned no image data${res?.error ? ` (${res.error})` : ''}.`;
            queueForVision(b64);
            const sizeDesc = res.width && res.height ? ` (${res.width}×${res.height}px — these are the exact screen coordinates)` : '';
            log(`desktop_screenshot: queued host capture ${res.width}x${res.height} for vision`);
            return `Screenshot taken${sizeDesc}. The image is now in your vision context — you can see the screen and identify element positions. Use desktop_click(x, y) with coordinates from the image to interact.`;
        } catch (err: any) {
            return `Error taking screenshot: ${err.message}`;
        }
    },
    toolset: 'terminal',
    tier: 'public',
});

registry.register({
    name: 'webcam_capture',
    description: 'Take a photo, picture, or selfie with the host webcam (camera) and load it into YOUR vision context. Use when the user asks to take a photo, snap a picture, take a selfie, see what the camera sees, or check who/what is in the room. The Warden orchestrator grabs the frame on the host. Call this yourself; do NOT delegate it to a sub-agent (sub-agents have no vision and cannot see the result). Returns the resolution.',
    schema: {
        type: 'object',
        properties: {
            device: { type: 'string', description: 'Optional: v4l2 device path (default /dev/video0).' },
            width: { type: 'number', description: 'Optional: requested frame width in pixels (default 640).' },
        },
        required: [],
    },
    handler: async (args) => {
        try {
            const res = await writeCallbackAsync('webcam_capture', args, 20000);
            if (!res || res.ok === false) {
                return `Error capturing webcam: ${res?.error || 'host callback failed'}`;
            }
            const b64 = typeof res.image === 'string' ? res.image : '';
            if (!b64) return `Error: host returned no image data${res?.error ? ` (${res.error})` : ''}.`;
            queueForVision(b64);
            log(`webcam_capture: queued host frame ${res.width}x${res.height} for vision`);
            return `Webcam frame captured (${res.width}×${res.height}px). The image is now in your vision context — describe what you see.`;
        } catch (err: any) {
            return `Error capturing webcam: ${err.message}`;
        }
    },
    toolset: 'terminal',
    tier: 'public',
});

registry.register({
    name: 'read_image',
    description: 'Read an image file from the HOST filesystem (any absolute path the Warden orchestrator can access) and load it into YOUR vision context. Use this for images outside the container workspace. Call this yourself; do NOT delegate it to a sub-agent (sub-agents have no vision and cannot see the result). Returns the dimensions. Only call this when the user actually points you at a specific image file path.',
    schema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Absolute path to the image file on the host.' },
        },
        required: ['path'],
    },
    handler: async (args) => {
        try {
            const res = await writeCallbackAsync('read_image', args, 20000);
            if (!res || res.ok === false) {
                return `Error reading image: ${res?.error || 'host callback failed'}`;
            }
            const b64 = typeof res.image === 'string' ? res.image : '';
            if (!b64) return `Error: host returned no image data${res?.error ? ` (${res.error})` : ''}.`;
            queueForVision(b64);
            log(`read_image: queued host image ${args.path} ${res.width}x${res.height} for vision`);
            return `Image loaded from ${args.path} (${res.width}×${res.height}px). It is now in your vision context — describe what you see.`;
        } catch (err: any) {
            return `Error reading image: ${err.message}`;
        }
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