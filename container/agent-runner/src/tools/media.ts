import { execSync } from 'child_process';
import { registry } from '../tool-registry.js';
import { log } from '../ipc-helpers.js';

// Audio + media-playback control. The Warden appliance uses a WM8960 codec
// whose ALSA card index shifts across reboots, so we locate it by name in
// /proc/asound/cards (never hardcode the index — see the WM8960 memory). On a
// box without a WM8960 (the laptop), fall back to WirePlumber's default sink /
// source via wpctl. Media playback goes through playerctl (MPRIS).

function run(cmd: string): string {
    try {
        return execSync(cmd, { encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch (err: any) {
        // execSync throws on non-zero exit; surface stderr so the model sees it.
        throw new Error((err.stderr || err.message || '').toString().trim() || `command failed: ${cmd}`);
    }
}

function has(cmd: string): boolean {
    try { execSync(`command -v ${cmd}`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }); return true; } catch { return false; }
}

/** Find the WM8960 soundcard's ALSA index by name (the index shifts across reboots). */
function wm8960Card(): string | null {
    try {
        const cards = run('cat /proc/asound/cards 2>/dev/null');
        const line = cards.split('\n').find(l => /wm8960/i.test(l));
        if (!line) return null;
        const idx = line.trim().split(/\s+/)[0];
        return /^\d+$/.test(idx) ? idx : null;
    } catch { return null; }
}

function clamp(level: any): number {
    const n = Math.round(Number(level));
    if (!Number.isFinite(n)) throw new Error('level must be a number 0-100');
    return Math.max(0, Math.min(100, n));
}

/** Parse amixer output for the first channel: "Front Left: Playback 80 [80%] [on]" → {level, muted}. */
function parseAmixer(out: string): { level: number | null; muted: boolean } {
    const pct = out.match(/\[(\d+)%\]/);
    const muted = /\[off\]/.test(out);
    return { level: pct ? Number(pct[1]) : null, muted };
}

// ─── Speaker / output volume ───────────────────────────────────────────────
async function setOutput(action: string, level: any): Promise<string> {
    const card = wm8960Card();
    if (card) {
        // WM8960 appliance: drive the "Speaker" analog amp directly via amixer.
        const c = `-c ${card}`;
        if (action === 'get') {
            const out = run(`amixer ${c} get Speaker 2>/dev/null`);
            const { level: l, muted } = parseAmixer(out);
            return `Speaker volume (WM8960): ${l ?? '?'}%${muted ? ' [MUTED]' : ''}`;
        }
        if (action === 'toggle_mute') {
            const out = run(`amixer ${c} set Speaker toggle 2>/dev/null`);
            const { muted } = parseAmixer(out);
            return `Speaker ${muted ? 'MUTED' : 'UNMUTED'} (WM8960).`;
        }
        // set
        const pct = clamp(level);
        run(`amixer ${c} set Speaker ${pct}% unmute 2>/dev/null`);
        return `Speaker volume set to ${pct}% (WM8960, unmuted).`;
    }
    // Laptop / no WM8960: WirePlumber default sink.
    if (!has('wpctl')) return 'Error: no audio backend found (neither amixer/WM8960 nor wpctl available).';
    const sink = '@DEFAULT_AUDIO_SINK@';
    if (action === 'get') {
        const out = run(`wpctl get-volume ${sink} 2>/dev/null`);
        const muted = /MUTED/i.test(out);
        const m = out.match(/Volume:\s*([0-9.]+)/);
        const pct = m ? Math.round(Number(m[1]) * 100) : null;
        return `Speaker volume: ${pct ?? '?'}%${muted ? ' [MUTED]' : ''}`;
    }
    if (action === 'toggle_mute') {
        run(`wpctl set-mute ${sink} toggle 2>/dev/null`);
        const out = run(`wpctl get-volume ${sink} 2>/dev/null`);
        return /MUTED/i.test(out) ? 'Speaker MUTED.' : 'Speaker UNMUTED.';
    }
    const pct = clamp(level);
    run(`wpctl set-volume ${sink} ${pct}% 2>/dev/null`);
    run(`wpctl set-mute ${sink} 0 2>/dev/null`);
    return `Speaker volume set to ${pct}% (unmuted).`;
}

// ─── Mic / input (capture) volume ──────────────────────────────────────────
async function setInput(action: string, level: any): Promise<string> {
    const card = wm8960Card();
    if (card) {
        const c = `-c ${card}`;
        if (action === 'get') {
            const out = run(`amixer ${c} get Capture 2>/dev/null`);
            const { level: l, muted } = parseAmixer(out);
            return `Mic volume (WM8960 Capture): ${l ?? '?'}%${muted ? ' [MUTED]' : ''}`;
        }
        if (action === 'toggle_mute') {
            const out = run(`amixer ${c} set Capture toggle 2>/dev/null`);
            const { muted } = parseAmixer(out);
            return `Mic ${muted ? 'MUTED' : 'UNMUTED'} (WM8960).`;
        }
        const pct = clamp(level);
        run(`amixer ${c} set Capture ${pct}% unmute 2>/dev/null`);
        return `Mic volume set to ${pct}% (WM8960 Capture, unmuted).`;
    }
    if (!has('wpctl')) return 'Error: no audio backend found (neither amixer/WM8960 nor wpctl available).';
    const src = '@DEFAULT_AUDIO_SOURCE@';
    if (action === 'get') {
        const out = run(`wpctl get-volume ${src} 2>/dev/null`);
        const muted = /MUTED/i.test(out);
        const m = out.match(/Volume:\s*([0-9.]+)/);
        const pct = m ? Math.round(Number(m[1]) * 100) : null;
        return `Mic volume: ${pct ?? '?'}%${muted ? ' [MUTED]' : ''}`;
    }
    if (action === 'toggle_mute') {
        run(`wpctl set-mute ${src} toggle 2>/dev/null`);
        const out = run(`wpctl get-volume ${src} 2>/dev/null`);
        return /MUTED/i.test(out) ? 'Mic MUTED.' : 'Mic UNMUTED.';
    }
    const pct = clamp(level);
    run(`wpctl set-volume ${src} ${pct}% 2>/dev/null`);
    run(`wpctl set-mute ${src} 0 2>/dev/null`);
    return `Mic volume set to ${pct}% (unmuted).`;
}

// ─── Media playback (MPRIS via playerctl) ──────────────────────────────────
async function mediaControl(action: string): Promise<string> {
    if (!has('playerctl')) {
        return 'Error: playerctl is not installed. Install it to control media playback — on Arch: `sudo pacman -S playerctl`; on Debian/Raspberry Pi OS: `sudo apt install -y playerctl`. Then a running player (browser YouTube, Spotify, mpv, VLC) exposes play/pause/next here.';
    }
    const verb = action === 'play_pause' ? 'play-pause' : action;
    try {
        const out = run(`playerctl ${verb} 2>&1`);
        // playerctl prints the status or the player name; a fresh status helps.
        let status = '';
        try { status = run(`playerctl status 2>/dev/null`); } catch { /* no player */ }
        return `Media ${verb}${status ? ` — ${status}` : ''}${out ? ` (${out})` : ''}.`;
    } catch (err: any) {
        const msg = (err.message || '').toString();
        if (/no.*player|No players/i.test(msg)) return 'No media player is running right now — nothing to control.';
        return `Media control failed: ${msg}`;
    }
}

registry.register({
    name: 'audio_volume',
    description: "Control the SPEAKER (output) volume. action 'get' returns the current level, 'set' takes level (0-100), 'toggle_mute' mutes/unmutes the speaker. Use this for the user's speaker loudness — not the mic.",
    schema: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['get', 'set', 'toggle_mute'], description: "What to do: 'get' current volume, 'set' to level, or 'toggle_mute'." },
            level: { type: 'number', description: "Target volume 0-100. Required when action='set', ignored otherwise." },
        },
        required: ['action'],
    },
    handler: async (args) => { try { return await setOutput(args.action, args.level); } catch (e: any) { log(`audio_volume error: ${e.message}`); return `Error: ${e.message}`; } },
    toolset: 'media',
    tier: 'public',
});

registry.register({
    name: 'mic_volume',
    description: "Control the MIC (input/capture) volume. action 'get' returns the current level, 'set' takes level (0-100), 'toggle_mute' mutes/unmutes the microphone. Use this for microphone sensitivity, not the speaker.",
    schema: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['get', 'set', 'toggle_mute'], description: "What to do: 'get' current mic level, 'set' to level, or 'toggle_mute'." },
            level: { type: 'number', description: "Target volume 0-100. Required when action='set', ignored otherwise." },
        },
        required: ['action'],
    },
    handler: async (args) => { try { return await setInput(args.action, args.level); } catch (e: any) { log(`mic_volume error: ${e.message}`); return `Error: ${e.message}`; } },
    toolset: 'media',
    tier: 'public',
});

registry.register({
    name: 'media_control',
    description: "Control media playback (play, pause, toggle, next track, previous track, stop) on a running media player — a browser YouTube tab, Spotify, mpv, VLC, etc. Anything exposing MPRIS. Returns the resulting playback status. If no player is running it says so.",
    schema: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['play', 'pause', 'play_pause', 'next', 'previous', 'stop'], description: 'Playback action.' },
        },
        required: ['action'],
    },
    handler: async (args) => { try { return await mediaControl(args.action); } catch (e: any) { log(`media_control error: ${e.message}`); return `Error: ${e.message}`; } },
    toolset: 'media',
    tier: 'public',
});