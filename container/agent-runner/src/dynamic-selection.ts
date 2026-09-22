/**
 * Dynamic selection — RAG-style relevance ranking so the orchestrator only
 * sees tools and Fabric prompt patterns relevant to the current request.
 *
 * Design constraints:
 *   - NEVER throw. Every export catches internally and returns a safe default
 *     (empty array / empty string / null) so callers fall back to current behavior.
 *   - Fabric index is lazy: built on first use from /workspace/global/prompts
 *     (read-only mount). Missing dir is a graceful no-op.
 */
import fs from 'fs';
import path from 'path';
import { log } from './ipc-helpers.js';

export const FABRIC_PROMPTS_DIR = process.env.FABRIC_PROMPTS_DIR ?? path.join(process.cwd(), 'groups', 'global', 'prompts');

/** Env override for a tunable, falling back to the shipped default. */
function numEnv(name: string, fallback: number): number {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Retuning these is a routing decision, not a code change — every one of them
// shifts which tools the seat can see for a given ask.
/** Keywords carried forward from the conversation into ranking. */
const KEYWORD_LIMIT = numEnv('SELECTION_KEYWORD_LIMIT', 24);
/** Conversation turns scanned for keywords: the latest user message + 4 prior. */
const CONTEXT_TURNS = numEnv('SELECTION_CONTEXT_TURNS', 5);
/** Per-turn char cap so one giant tool dump cannot drown the user request. */
const TURN_CHAR_CAP = numEnv('SELECTION_TURN_CHAR_CAP', 4000);
/** The latest user message outweighs older turns by this factor. */
const LATEST_USER_WEIGHT = numEnv('SELECTION_LATEST_USER_WEIGHT', 3);
/** Tools handed to the seat per turn. */
const TOOL_TOPK = numEnv('SELECTION_TOOL_TOPK', 12);
/** Fabric patterns listed in the RELEVANT PATTERNS section. */
const FABRIC_TOPK = numEnv('SELECTION_FABRIC_TOPK', 5);
/** Weight a generic tool competes at once any specific tool has scored. */
const GENERIC_TOOL_WEIGHT = numEnv('SELECTION_GENERIC_TOOL_WEIGHT', 0.5);

// A name hit is the strongest signal a tool owns the job, a bigram is a phrase
// the user actually said, a description hit is the weakest — it fires on any
// tool whose prose happens to mention the word.
const SCORE_NAME_MATCH = 3;
const SCORE_BIGRAM_MATCH = 2;
const SCORE_DESC_MATCH = 1;

const STOPWORDS = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'her', 'was', 'one',
    'our', 'out', 'his', 'has', 'have', 'had', 'how', 'its', 'may', 'new', 'now', 'old', 'see',
    'two', 'way', 'who', 'did', 'get', 'got', 'him', 'she', 'too', 'use', 'that', 'this', 'with',
    'from', 'they', 'will', 'would', 'there', 'their', 'what', 'about', 'which', 'when', 'were',
    'them', 'then', 'than', 'some', 'into', 'only', 'over', 'such', 'your', 'just', 'also',
    'like', 'want', 'need', 'make', 'made', 'please', 'could', 'should', 'been', 'being', 'does',
    'done', 'here', 'each', 'very', 'more', 'most', 'much', 'many', 'after', 'before', 'where',
    'while', 'these', 'those', 'because', 'between', 'something', 'anything', 'thing', 'things',
    'give', 'know', 'let', 'lets', 'tell', 'show', 'okay', 'yes', 'no', 'hey', 'hello', 'thanks',
    'thank', 'going', 'doing', 'really',
]);

function tokenize(text: string): string[] {
    return (text || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

/** Split a snake_case / camelCase identifier into lowercase words. */
function splitIdentifier(name: string): string[] {
    return (name || '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 2);
}

interface ChatMessage {
    role: string;
    content?: string;
}

/**
 * Pull salient keywords (unigrams + bigrams) from the latest user message plus
 * the last few conversation turns. The latest user message is weighted 3x.
 * Returns up to `limit` keywords sorted by score. Bigrams use a space separator.
 */
export function extractKeywords(messages: ChatMessage[], limit = KEYWORD_LIMIT): string[] {
    try {
        const textTurns = (messages || []).filter(
            (m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim()
        );
        if (textTurns.length === 0) return [];
        const lastUserIdx = (() => {
            for (let i = textTurns.length - 1; i >= 0; i--) {
                if (textTurns[i].role === 'user') return i;
            }
            return -1;
        })();
        const start = Math.max(0, textTurns.length - CONTEXT_TURNS);
        const scores = new Map<string, number>();
        const bump = (k: string, by: number) => scores.set(k, (scores.get(k) || 0) + by);
        for (let i = start; i < textTurns.length; i++) {
            const weight = i === lastUserIdx ? LATEST_USER_WEIGHT : 1;
            const tokens = tokenize((textTurns[i].content || '').slice(0, TURN_CHAR_CAP));
            for (const t of tokens) bump(t, weight);
            for (let j = 0; j < tokens.length - 1; j++) {
                bump(`${tokens[j]} ${tokens[j + 1]}`, weight);
            }
        }
        return [...scores.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([k]) => k);
    } catch (err: any) {
        log(`[dynamic-selection] extractKeywords failed: ${err?.message || err}`);
        return [];
    }
}

/** Ollama-style tool def shape (already tier-stripped): { type, function: { name, description } } */
interface OllamaToolDef {
    type?: string;
    function?: { name?: string; description?: string };
}

function scoreText(keywords: string[], nameWords: Set<string>, descText: string): number {
    let score = 0;
    for (const kw of keywords) {
        if (kw.includes(' ')) {
            // bigram: substring match against description / joined name
            if (descText.includes(kw)) score += SCORE_BIGRAM_MATCH;
        } else {
            if (nameWords.has(kw)) score += SCORE_NAME_MATCH;
            else if (descText.includes(kw)) score += SCORE_DESC_MATCH;
        }
    }
    return score;
}

// Generic filesystem/shell tools score on almost any sentence, so on a vague
// ask they crowd out the specific tool that owns the job ("change the song"
// → read_file/list_file/bash, observed 2026-09-19). When any SPECIFIC tool
// scores at all, generic ones compete at GENERIC_TOOL_WEIGHT — they still
// surface for genuinely generic asks, but a specific match beats them.
// Every name here must match a REGISTERED tool exactly: this is a Set lookup on
// the live tool name, so a near-miss fails closed and silently exempts that
// tool from the halving (2026-09-22: `edit_file`, `Read_file` and lowercase
// `bash` had never matched anything). Registry names are PascalCase
// (tools/file-*.ts, terminal.ts); the core builtins are snake_case (skills.ts).
const GENERIC_TOOLS = new Set([
    'read_file', 'write_file', 'list_file',
    'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'open_app',
]);

/**
 * Rank tool defs by keyword overlap against tool name (snake_case split) +
 * description. Returns the names of the top-K tools that scored above zero.
 */
export function rankTools(toolDefs: OllamaToolDef[], keywords: string[], topK = TOOL_TOPK): string[] {
    try {
        if (!keywords || keywords.length === 0) return [];
        const scored: Array<{ name: string; score: number }> = [];
        for (const def of toolDefs || []) {
            const name = def?.function?.name;
            if (!name) continue;
            const nameWords = new Set(splitIdentifier(name));
            const descText = `${[...nameWords].join(' ')} ${(def.function?.description || '').toLowerCase()}`;
            const score = scoreText(keywords, nameWords, descText);
            if (score > 0) scored.push({ name, score });
        }
        const anySpecific = scored.some((s) => s.score > 0 && !GENERIC_TOOLS.has(s.name));
        const weight = (n: string) => anySpecific && GENERIC_TOOLS.has(n) ? GENERIC_TOOL_WEIGHT : 1;
        const ranked = scored
            .map((s) => ({ ...s, rank: s.score * weight(s.name) }))
            .sort((a, b) => b.rank - a.rank)
            .slice(0, topK);
        // One line per turn showing what actually won and at what score — the
        // only way to see a specific tool losing to a generic one (the youtube
        // failure ranked #1 in isolation but lost in the live pool).
        log(`[dynamic-selection] top-${topK}: ${ranked.map((s) => `${s.name}=${s.score}${weight(s.name) < 1 ? '*' : ''}`).join(', ')}${anySpecific ? ' (* generic, halved)' : ''}`);
        return ranked.map((s) => s.name);
    } catch (err: any) {
        log(`[dynamic-selection] rankTools failed: ${err?.message || err}`);
        return [];
    }
}

// ─── Fabric pattern index ────────────────────────────────────────────────

export interface FabricPattern {
    name: string;
    description: string;
}

let fabricIndex: Map<string, FabricPattern> | null = null;

/** Find the system prompt file inside a pattern dir (system.md / SYSTEM.md / etc). */
function findSystemFile(dir: string): string | null {
    try {
        const entry = fs.readdirSync(dir).find((f) => /^system\.md$/i.test(f));
        return entry ? path.join(dir, entry) : null;
    } catch {
        return null;
    }
}

/**
 * Lazily build (and cache) the Fabric pattern index:
 * pattern name → first ~150 chars of its system prompt.
 * Returns an empty map if the prompts dir is missing or unreadable.
 */
export function getFabricIndex(): Map<string, FabricPattern> {
    if (fabricIndex) return fabricIndex;
    const index = new Map<string, FabricPattern>();
    try {
        if (!fs.existsSync(FABRIC_PROMPTS_DIR)) {
            log(`[fabric] prompts dir not found: ${FABRIC_PROMPTS_DIR} (fabric patterns disabled)`);
            fabricIndex = index;
            return index;
        }
        const entries = fs.readdirSync(FABRIC_PROMPTS_DIR, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const sysFile = findSystemFile(path.join(FABRIC_PROMPTS_DIR, entry.name));
            if (!sysFile) continue;
            try {
                // Read only the head of the file — we just need a short description
                const fd = fs.openSync(sysFile, 'r');
                const buf = Buffer.alloc(600);
                const bytes = fs.readSync(fd, buf, 0, 600, 0);
                fs.closeSync(fd);
                const head = buf.toString('utf-8', 0, bytes);
                const description = head
                    .replace(/^#+\s*/gm, '')        // strip markdown headers
                    .replace(/[*_`>]/g, '')          // strip md punctuation
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 150);
                index.set(entry.name, { name: entry.name, description });
            } catch {
                /* skip unreadable pattern */
            }
        }
        log(`[fabric] indexed ${index.size} prompt patterns from ${FABRIC_PROMPTS_DIR}`);
    } catch (err: any) {
        log(`[fabric] index build failed: ${err?.message || err}`);
    }
    fabricIndex = index;
    return index;
}

/** Rank Fabric patterns by keyword overlap against name (snake_case split) + description. */
export function rankFabricPatterns(keywords: string[], topK = FABRIC_TOPK): FabricPattern[] {
    try {
        if (!keywords || keywords.length === 0) return [];
        const index = getFabricIndex();
        if (index.size === 0) return [];
        const scored: Array<{ pattern: FabricPattern; score: number }> = [];
        for (const pattern of index.values()) {
            const nameWords = new Set(splitIdentifier(pattern.name));
            const descText = `${[...nameWords].join(' ')} ${pattern.description.toLowerCase()}`;
            const score = scoreText(keywords, nameWords, descText);
            if (score > 0) scored.push({ pattern, score });
        }
        return scored.sort((a, b) => b.score - a.score).slice(0, topK).map((s) => s.pattern);
    } catch (err: any) {
        log(`[dynamic-selection] rankFabricPatterns failed: ${err?.message || err}`);
        return [];
    }
}

/**
 * Read the FULL system prompt of a Fabric pattern by name.
 * Returns null if the pattern doesn't exist or can't be read.
 */
export function getFabricPatternContent(name: string): string | null {
    try {
        const clean = (name || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (!clean) return null;
        const dir = path.join(FABRIC_PROMPTS_DIR, clean);
        // Guard against traversal even though we sanitized
        if (!dir.startsWith(FABRIC_PROMPTS_DIR)) return null;
        if (!fs.existsSync(dir)) return null;
        const sysFile = findSystemFile(dir);
        if (!sysFile) return null;
        return fs.readFileSync(sysFile, 'utf-8');
    } catch (err: any) {
        log(`[fabric] read pattern '${name}' failed: ${err?.message || err}`);
        return null;
    }
}

/**
 * Build the `## RELEVANT PATTERNS` system-prompt section for the top-ranked
 * Fabric patterns. Returns '' if nothing scores above zero (section omitted).
 */
export function buildRelevantPatternsSection(keywords: string[], topK = FABRIC_TOPK): string {
    try {
        const patterns = rankFabricPatterns(keywords, topK);
        if (patterns.length === 0) return '';
        // JSON members — the orchestrator prompt around this section is dense
        // nested JSON (granite's preferred shape), so the section matches.
        const items = patterns.map((p) => `${JSON.stringify(p.name)}: ${JSON.stringify(p.description || 'expert prompt pattern')}`);
        return `{"relevant_patterns":{"load":"fabric_pattern(name), then follow it — directly, or folded into a {task} brief when delegating","items":{${items.join(',')}}}}\n`;
    } catch (err: any) {
        log(`[dynamic-selection] buildRelevantPatternsSection failed: ${err?.message || err}`);
        return '';
    }
}
