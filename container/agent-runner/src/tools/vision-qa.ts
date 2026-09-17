import path from 'path';
import { execSync } from 'child_process';
import { registry } from '../tool-registry.js';
import { log } from '../ipc-helpers.js';
import { resolveFilePath } from './file-read.js';

// Vision Q&A — visionless seats (e.g. vulkan on glm-5.3:cloud, which 400s with
// "this model does not support image input") get their images explained by a
// vision-capable model instead of losing them. The vision model is resolved
// lazily by the setter index.ts registers: an explicit VISION_MODEL override,
// else the atlas seat's model, else the orchestrator's (both currently run
// qwen2.5-vl-class vision models). Two entry points:
//   - askVisionModel(): used by the image-drain paths in index.ts to produce a
//     one-shot description when a visionless agent Reads an image
//   - the query_image tool: the agent asks focused follow-up questions about an
//     image file and iterates until it understands the image

let visionModelResolver: () => string[] = () => [];

export function setVisionModelResolver(fn: () => string[]) {
    visionModelResolver = fn;
}

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

// Per-model vision-capability cache. A model's capabilities don't change at
// runtime, so check each name once via /api/show and remember the answer.
const visionCapCache = new Map<string, boolean>();

async function isVisionCapable(model: string): Promise<boolean> {
    if (visionCapCache.has(model)) return visionCapCache.get(model)!;
    let capable = false;
    try {
        const r = await fetch(`${OLLAMA_URL}/api/show`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: model }),
            signal: AbortSignal.timeout(10_000),
        });
        if (r.ok) {
            const d = (await r.json()) as any;
            capable = Array.isArray(d?.capabilities) && d.capabilities.includes('vision');
        }
    } catch { /* unknown — treat as not vision-capable */ }
    visionCapCache.set(model, capable);
    return capable;
}

// Discover a LOCAL vision-capable model (skip cloud-routed `:cloud` names) for
// when no configured seat can see images. The operator's usual vision model is
// a local qwen, so prefer the qwen family then the smallest; cached after the
// first discovery so this costs one /api/tags + a few /api/show calls ever.
let discoveredVisionModel: string | null | undefined;

async function discoverLocalVisionModel(): Promise<string | null> {
    if (discoveredVisionModel !== undefined) return discoveredVisionModel;
    discoveredVisionModel = null;
    try {
        const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(10_000) });
        if (!r.ok) return discoveredVisionModel;
        const d = (await r.json()) as any;
        const seen: { name: string; size: number }[] = [];
        for (const m of (d?.models || []) as any[]) {
            const name = String(m?.name || '');
            if (!name || name.endsWith(':cloud')) continue;
            if (!(await isVisionCapable(name))) continue;
            seen.push({ name, size: Number(m?.details?.parameter_size || 0) });
        }
        if (!seen.length) return discoveredVisionModel;
        const qwen = seen.filter((s) => /qwen/i.test(s.name)).sort((a, b) => a.size - b.size);
        const pick = qwen[0] || seen.sort((a, b) => a.size - b.size)[0];
        discoveredVisionModel = pick.name;
    } catch { /* leave null */ }
    return discoveredVisionModel;
}

/** Ask a vision-capable model about one or more base64 images. Never throws. */
export async function askVisionModel(
    images: string[],
    question: string,
): Promise<{ ok: boolean; answer: string; error?: string }> {
    const candidates = visionModelResolver().map((m) => m.trim()).filter(Boolean);
    // A text-only seat (e.g. glm-5.3:cloud) must never become the vision model
    // — that is exactly what silently blinded visionless agents before
    // (2026-09-17: vision reports 400'd "does not support image input").
    const models: string[] = [];
    const push = (m: string) => { if (m && !models.includes(m)) models.push(m); };

    // 1. Explicit VISION_MODEL override, if vision-capable.
    const explicit = candidates[0];
    if (explicit && (await isVisionCapable(explicit))) push(explicit);
    // 2. A local vision-capable model (operator's usual = local qwen), unless the
    //    override already picked one.
    const local = await discoverLocalVisionModel();
    if (local && local !== explicit) push(local);
    // 3. Vision-capable seats (atlas, orchestrator) as a last resort.
    for (const m of candidates) if (await isVisionCapable(m)) push(m);

    if (!models.length) return { ok: false, answer: '', error: 'no vision-capable model available (all seats are text-only and no local vision model found)' };

    let lastError = '';
    for (const model of models) {
        try {
            const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: question, images }],
                    stream: false,
                    keep_alive: 300,
                    options: { temperature: 0.2, num_predict: 1024 },
                }),
                signal: AbortSignal.timeout(90_000),
            });
            if (!resp.ok) {
                const body = await resp.text().catch(() => '');
                lastError = `vision model "${model}" error: ${resp.status} ${resp.statusText}${body ? ` (${body.slice(0, 200)})` : ''}`;
                if (/does not support image input/i.test(body)) visionCapCache.set(model, false);
                continue;
            }
            const data = (await resp.json()) as any;
            const answer = String(data?.message?.content || '').trim();
            if (!answer) { lastError = `vision model "${model}" returned no content`; continue; }
            return { ok: true, answer };
        } catch (err: any) {
            lastError = String(err?.message || err);
        }
    }
    return { ok: false, answer: '', error: lastError || 'vision model unavailable' };
}

/** Load an image file and downscale to ≤512px jpeg base64 (mirrors Read's
 *  thumbnailing so the vision call costs the same as a Read vision attach). */
function loadImageB64(rawPath: string): string | null {
    const filePath = resolveFilePath(rawPath);
    const ext = path.extname(filePath).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'].includes(ext)) return null;
    try {
        return execSync(`convert "${filePath}" -resize 512x512\\> -quality 75 jpeg:- 2>/dev/null`, { maxBuffer: 5 * 1024 * 1024 }).toString('base64');
    } catch {
        return null; // ImageMagick missing or unreadable file — caller reports the error
    }
}

registry.register({
    name: 'query_image',
    description: 'Ask a vision-capable model a question about an image file and get a textual answer. Use this whenever YOU cannot see images (a visionless model): check what a screenshot shows, whether UI looks right, what text a picture contains, etc. Iterate — ask focused follow-up questions until you fully understand the image. Works on any image file path.',
    schema: {
        type: 'object',
        properties: {
            file_path: { type: 'string', description: 'Path to the image: workspace-relative, absolute, or ~.' },
            question: { type: 'string', description: 'What you want to know about the image. Be specific; ask follow-ups as needed.' },
        },
        required: ['file_path', 'question'],
    },
    handler: async (args) => {
        const q = String(args.question || '').trim() || 'Describe this image in detail.';
        const b64 = loadImageB64(String(args.file_path || ''));
        if (!b64) return `Error: could not load image "${args.file_path}" (not found, or not a supported image type).`;
        log(`query_image: asking vision model about ${args.file_path}`);
        const res = await askVisionModel([b64], q);
        if (!res.ok || !res.answer) return `Error from the vision model: ${res.error || 'no content'}. Proceed without the image; do not retry more than once.`;
        return `[Vision model answer] ${res.answer}`;
    },
    toolset: 'file',
    tier: 'both',
});