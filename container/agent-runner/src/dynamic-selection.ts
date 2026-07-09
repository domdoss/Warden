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
export function extractKeywords(messages: ChatMessage[], limit = 24): string[] {
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
        // Latest user message + up to 4 preceding turns
        const start = Math.max(0, textTurns.length - 5);
        const scores = new Map<string, number>();
        const bump = (k: string, by: number) => scores.set(k, (scores.get(k) || 0) + by);
        for (let i = start; i < textTurns.length; i++) {
            const weight = i === lastUserIdx ? 3 : 1;
            // Cap each turn so a giant tool dump doesn't drown the user request
            const tokens = tokenize((textTurns[i].content || '').slice(0, 4000));
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
            if (descText.includes(kw)) score += 2;
        } else {
            if (nameWords.has(kw)) score += 3;
            else if (descText.includes(kw)) score += 1;
        }
    }
    return score;
}

/**
 * Rank tool defs by keyword overlap against tool name (snake_case split) +
 * description. Returns the names of the top-K tools that scored above zero.
 */
export function rankTools(toolDefs: OllamaToolDef[], keywords: string[], topK = 12): string[] {
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
        return scored.sort((a, b) => b.score - a.score).slice(0, topK).map((s) => s.name);
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
export function rankFabricPatterns(keywords: string[], topK = 5): FabricPattern[] {
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
export function buildRelevantPatternsSection(keywords: string[], topK = 5): string {
    try {
        const patterns = rankFabricPatterns(keywords, topK);
        if (patterns.length === 0) return '';
        const lines = patterns.map((p) => `- ${p.name} — ${p.description || 'expert prompt pattern'}`);
        return `## RELEVANT PATTERNS

The following expert prompt patterns may fit this request. If one of these expert patterns fits the task, call fabric_pattern(name) to load it and follow it.

${lines.join('\n')}

`;
    } catch (err: any) {
        log(`[dynamic-selection] buildRelevantPatternsSection failed: ${err?.message || err}`);
        return '';
    }
}
