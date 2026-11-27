/**
 * Semantic tool selection — dense embeddings (bge-m3 via Ollama) fused with
 * the existing lexical ranker.
 *
 * Why: the lexical ranker only matches spelled words. Asks like "put on some
 * chill" or "what did we decide about the BBS" share no tokens with the tool
 * that owns the job, so the right tool never enters the menu and a small seat
 * model compensates badly (wrong tool, refusal, hallucinated tool). Dense
 * embeddings add meaning without giving up the name-match precision the
 * lexical pass already has.
 *
 * Safety:
 *  - Never throws; returns null / lexical results on any failure so the caller
 *    falls back to the existing behaviour.
 *  - The tool-vector batch is background-warmed. A menu build is never blocked
 *    waiting for a cold model: until the vectors are ready the ranker is
 *    lexical, then semantic on the next turn.
 *  - The query embed has a hard timeout; the cold model load is paid by the
 *    warm-up at process start, not by the user's turn.
 */
import { log } from './ipc-helpers.js';
import { scoreTools, isGenericTool } from './dynamic-selection.js';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.SELECTION_EMBED_MODEL || 'qwen3-embedding:0.6b';
const ENABLED = process.env.SELECTION_SEMANTIC !== '0';
const QUERY_TIMEOUT_MS = numEnv('SELECTION_EMBED_TIMEOUT_MS', 2500);
const SEMANTIC_WEIGHT = numEnv('SELECTION_SEMANTIC_WEIGHT', 0.8);
const LEXICAL_WEIGHT = numEnv('SELECTION_LEXICAL_WEIGHT', 0.2);
const NAME_BONUS = numEnv('SELECTION_NAME_BONUS', 0.25);
const GENERIC_WEIGHT = numEnv('SELECTION_GENERIC_WEIGHT', 0.7);
const KEEP_ALIVE = process.env.SELECTION_EMBED_KEEP_ALIVE || '24h';
const QUERY_CACHE_MAX = 200;

type ToolDef = any;

const queryCache = new Map<string, number[]>();
// Pools are keyed by signature: the seat and each sub-agent delegate carry
// different tool sets, and a single global slot made them evict each other's
// vectors on every alternating call.
const poolCache = new Map<string, number[][]>();
const poolWarm = new Map<string, Promise<void>>();
const POOL_CACHE_MAX = 4;

function numEnv(name: string, fallback: number): number {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function toolName(def: ToolDef): string {
    return String(def?.function?.name || '');
}

/** The text we embed for a tool: its spoken name + its description. */
function toolText(def: ToolDef): string {
    const name = toolName(def)
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    const desc = String(def?.function?.description || '').replace(/\s+/g, ' ').slice(0, 600);
    return `${name}. ${desc}`.trim();
}

function djb2(s: string): string {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}

function signature(defs: ToolDef[]): string {
    return `${MODEL}|${defs.map((d) => `${toolName(d)}:${djb2(toolText(d))}`).join('|')}`;
}

async function embed(inputs: string[], timeoutMs: number): Promise<number[][]> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(`${OLLAMA_URL}/api/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: MODEL, input: inputs, keep_alive: KEEP_ALIVE }),
            signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`embed HTTP ${res.status}`);
        const data: any = await res.json();
        const vecs = data?.embeddings;
        if (!Array.isArray(vecs) || vecs.length !== inputs.length) {
            throw new Error('embed response shape');
        }
        return vecs as number[][];
    } finally {
        clearTimeout(timer);
    }
}

function cosine(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function nameWords(name: string): Set<string> {
    return new Set(name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

/**
 * Background-warm the embedding model and the current tool pool. Safe to call
 * every turn; it no-ops when the pool signature already matches.
 */
export function warmToolVectorPool(defs: ToolDef[]): void {
    if (!ENABLED || !defs || defs.length === 0) return;
    const sig = signature(defs);
    if (poolCache.has(sig) || poolWarm.has(sig)) return;
    const p = embed(defs.map(toolText), 60_000)
        .then((vecs) => {
            if (poolCache.size >= POOL_CACHE_MAX) {
                const oldest = poolCache.keys().next().value;
                if (oldest !== undefined && oldest !== sig) poolCache.delete(oldest);
            }
            poolCache.set(sig, vecs);
            log(`[semantic-selection] tool vectors ready (${vecs.length})`);
        })
        .catch((err: any) => {
            log(`[semantic-selection] tool warm failed: ${err?.message || err}`);
        })
        .finally(() => { poolWarm.delete(sig); });
    poolWarm.set(sig, p);
}

async function queryVector(text: string): Promise<number[] | null> {
    const hit = queryCache.get(text);
    if (hit) return hit;
    try {
        const [vec] = await embed([text], QUERY_TIMEOUT_MS);
        if (!vec) return null;
        if (queryCache.size >= QUERY_CACHE_MAX) {
            const oldest = queryCache.keys().next().value;
            if (oldest !== undefined) queryCache.delete(oldest);
        }
        queryCache.set(text, vec);
        return vec;
    } catch (err: any) {
        log(`[semantic-selection] query embed failed: ${err?.message || err}`);
        return null;
    }
}

/**
 * Dense similarity for each tool, or null when the pool is not warm yet / the
 * embedding service is unavailable. Callers must fall back to lexical on null.
 */
export async function semanticToolScores(defs: ToolDef[], query: string): Promise<Map<string, number> | null> {
    if (!ENABLED || !query || !defs || defs.length === 0) return null;
    const sig = signature(defs);
    let vecs = poolCache.get(sig);
    if (!vecs) {
        warmToolVectorPool(defs);
        // Give a warm model ~1.5s to produce the tool vectors so the FIRST menu
        // of a turn can use them. A cold model load (tens of seconds) is never
        // waited on: the timeout falls through to lexical, and the next turn is
        // semantic once the background batch lands.
        const p = poolWarm.get(sig);
        if (p) {
            await Promise.race([
                p,
                new Promise<void>((resolve) => setTimeout(resolve, 1500)),
            ]);
        }
        vecs = poolCache.get(sig);
    }
    if (!vecs) return null;
    const qv = await queryVector(query);
    if (!qv) return null;
    const out = new Map<string, number>();
    defs.forEach((d, i) => {
        const v = vecs?.[i];
        if (v) out.set(toolName(d), cosine(qv, v));
    });
    return out;
}

/**
 * Fuse lexical and semantic scores into the final top-K tool names.
 * Name matches get an explicit bonus (the user literally named the tool), and
 * generic filesystem/shell tools stay damped.
 */
function fuseScores(defs: ToolDef[], lexical: { name: string; score: number }[], sem: Map<string, number>, keywords: string[], topK: number): string[] {
    const lexMax = Math.max(...lexical.map((s) => s.score), 1e-9);
    const lexMap = new Map(lexical.map((s) => [s.name, s.score]));
    const semMax = Math.max(...[...sem.values()], 1e-9);
    const kw = new Set(keywords.filter((k) => !k.includes(' ')));

    const scored = defs
        .map((d) => {
            const n = toolName(d);
            if (!n) return null;
            const lexNorm = (lexMap.get(n) || 0) / lexMax;
            const semRaw = sem.get(n);
            const semNorm = semRaw === undefined ? 0 : Math.max(0, semRaw) / semMax;
            let final = SEMANTIC_WEIGHT * semNorm + LEXICAL_WEIGHT * lexNorm;
            const words = nameWords(n);
            for (const k of kw) {
                if (words.has(k)) { final += NAME_BONUS; break; }
            }
            if (isGenericTool(n)) final *= GENERIC_WEIGHT;
            return { name: n, final };
        })
        .filter((x): x is { name: string; final: number } => !!x)
        .sort((a, b) => b.final - a.final);

    const top = scored.slice(0, topK);
    log(`[semantic-selection] hybrid top-${topK}: ${top.map((s) => `${s.name}=${s.final.toFixed(2)}`).join(', ')}`);
    return top.map((s) => s.name);
}

export async function hybridRank(defs: ToolDef[], query: string, keywords: string[], topK: number): Promise<string[]> {
    const lexical = scoreTools(defs, keywords);
    const lexicalTop = lexical.slice(0, topK).map((s) => s.name);
    if (!ENABLED) return lexicalTop;

    const sem = await semanticToolScores(defs, query);
    if (!sem || sem.size === 0) return lexicalTop;
    return fuseScores(defs, lexical, sem, keywords, topK);
}

/** The query embedding, cached. Used by callers that must precompute it
 *  before entering a synchronous path (e.g. sub-agent tool selection). */
export async function embedQuery(text: string): Promise<number[] | null> {
    if (!ENABLED || !text) return null;
    return queryVector(text);
}

/** Synchronous fusion for callers that already hold a query vector. Falls
 *  back to lexical when the pool vectors aren't warm yet (and kicks the warm). */
export function hybridRankSync(defs: ToolDef[], keywords: string[], qv: number[] | null, topK: number): string[] {
    const lexical = scoreTools(defs, keywords);
    const lexicalTop = lexical.slice(0, topK).map((s) => s.name);
    if (!ENABLED || !qv) return lexicalTop;
    const vecs = poolCache.get(signature(defs));
    if (!vecs) {
        warmToolVectorPool(defs);
        return lexicalTop;
    }
    const sem = new Map<string, number>();
    defs.forEach((d, i) => {
        const v = vecs?.[i];
        if (v) sem.set(toolName(d), cosine(qv, v));
    });
    if (sem.size === 0) return lexicalTop;
    return fuseScores(defs, lexical, sem, keywords, topK);
}

// Keep bge-m3 resident so a turn's query embed is ~15-45ms instead of a cold
// ~29s model load. This never blocks a turn (fire-and-forget) and a failure is
// harmless — the ranker simply stays lexical.
if (ENABLED) {
    void embed(['warm'], 60_000)
        .then(() => log(`[semantic-selection] embedding model warm (${MODEL})`))
        .catch((err: any) => log(`[semantic-selection] warm failed: ${err?.message || err}`));
}
