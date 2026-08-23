import { registry } from '../tool-registry.js';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

// A real desktop Chrome User-Agent. The old "Mozilla/5.0 (compatible; Warden/1.0)"
// string was flagged/blocked by some sites (and returned empty shells).
const CHROME_UA =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/131.0.0.0 Safari/537.36';

const MAX_CHARS = 50_000;

registry.register({
    name: 'WebSearch',
    description: 'Search the web and return results.',
    schema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Search query' },
            max_results: { type: 'number', description: 'Max results (default 5)' },
        },
        required: ['query'],
    },
    handler: async (args, _context) => {
        try {
            const query = encodeURIComponent(args.query);
            const max = args.max_results || 5;
            const response = await fetch(`https://html.duckduckgo.com/html/?q=${query}`, {
                headers: { 'User-Agent': CHROME_UA },
            });
            const html = await response.text();
            const results: string[] = [];
            const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
            let match;
            while ((match = resultRegex.exec(html)) !== null && results.length < max) {
                const url = decodeURIComponent(match[1].replace(/.*uddg=/, '').replace(/&.*/, ''));
                const title = match[2].replace(/<[^>]+>/g, '').trim();
                const snippet = match[3].replace(/<[^>]+>/g, '').trim();
                results.push(`${title}\n${url}\n${snippet}`);
            }
            return results.length > 0 ? results.join('\n\n') : 'No results found.';
        } catch (err: any) {
            return `Error searching web: ${err.message}`;
        }
    },
    toolset: 'web',
    tier: 'public',
});

/**
 * Convert a linkedom element tree to Markdown. A lightweight recursive walker —
 * not a full engine, but it preserves the structure that matters for reading
 * (headings, links, lists, code, tables, blockquotes, paragraphs) so the agent
 * can actually scan a fetched page instead of a flat space-joined blob.
 */
/** Resolve possibly-relative href/src against the page URL so links are navigable. */
function abs(url: string, baseUrl: string): string {
    try { return new URL(url, baseUrl).toString(); } catch { return url; }
}

function domToMarkdown(node: any, baseUrl: string = '', depth = 0): string {
    // linkedom nodes expose nodeType / nodeName / textContent / attributes / children
    const NODE_TEXT = 3, NODE_ELEMENT = 1;
    if (node.nodeType === NODE_TEXT) return node.nodeValue || '';
    if (node.nodeType !== NODE_ELEMENT) return '';

    const tag = (node.tagName || '').toLowerCase();
    const kids = () => Array.from(node.childNodes || []).map((c: any) => domToMarkdown(c, baseUrl, depth + 1)).join('');

    switch (tag) {
        case 'script':
        case 'style':
        case 'noscript':
        case 'svg':
            return '';
        case 'br':
            return '\n';
        case 'h1': return `\n\n# ${kids().trim()}\n\n`;
        case 'h2': return `\n\n## ${kids().trim()}\n\n`;
        case 'h3': return `\n\n### ${kids().trim()}\n\n`;
        case 'h4': return `\n\n#### ${kids().trim()}\n\n`;
        case 'h5': return `\n\n##### ${kids().trim()}\n\n`;
        case 'h6': return `\n\n###### ${kids().trim()}\n\n`;
        case 'p': return `\n\n${kids().trim()}\n\n`;
        case 'pre': {
            const code = (node.textContent || '').replace(/```/g, '\\```');
            return `\n\n\`\`\`\n${code.trim()}\n\`\`\`\n\n`;
        }
        case 'code': {
            // Inline code if inside a <pre> the block handler already captured text;
            // otherwise wrap inline.
            const text = node.textContent || '';
            return /\n/.test(text) ? `\n\n\`\`\`\n${text.trim()}\n\`\`\`\n\n` : `\`${text}\``;
        }
        case 'blockquote': return `\n\n${kids().trim().split('\n').map((l: string) => `> ${l}`).join('\n')}\n\n`;
        case 'a': {
            const href = node.getAttribute && node.getAttribute('href');
            const text = kids().trim();
            if (!text) return '';
            // Anchors, javascript: and mailto: aren't navigable pages — keep just the text.
            if (!href || href.startsWith('javascript:') || href.startsWith('#') || href.startsWith('mailto:')) return text;
            return `[${text}](${abs(href, baseUrl)})`;
        }
        case 'img': {
            const rawSrc = node.getAttribute && (node.getAttribute('src') || node.getAttribute('data-src'));
            const alt = (node.getAttribute && node.getAttribute('alt')) || '';
            if (!rawSrc) return alt ? alt : '';
            return `\n\n![${alt}](${abs(rawSrc, baseUrl)})\n\n`;
        }
        case 'li': return `\n- ${kids().trim()}\n`;
        case 'ul':
        case 'ol': return `\n\n${kids()}\n`;
        case 'table': {
            const rows: any[] = Array.from(node.querySelectorAll('tr') || []);
            if (rows.length === 0) return kids();
            const lines = rows.map((tr: any) => {
                const cells: any[] = Array.from(tr.querySelectorAll('th,td') || []);
                return `| ${cells.map((c: any) => (c.textContent || '').replace(/\|/g, '\\|').trim()).join(' | ')} |`;
            });
            // Add a header separator after the first row if it contains <th>.
            const firstHasTh = (Array.from(rows[0].querySelectorAll('th') || []) as any[]).length > 0;
            if (firstHasTh && lines.length >= 1) {
                const firstCells: any[] = Array.from(rows[0].querySelectorAll('th,td') || []);
                const sep = `| ${firstCells.map(() => '---').join(' | ')} |`;
                lines.splice(1, 0, sep);
            }
            return `\n\n${lines.join('\n')}\n\n`;
        }
        default:
            return kids();
    }
}

function extractMarkdown(html: string, baseUrl: string): string {
    const document: any = (parseHTML(html) as any).document;
    // Readability extracts the main article and drops nav/footer/ads/boilerplate.
    // It mutates the DOM, so run it on a cloned document and fall back to the
    // <article>/<main> or <body> if it returns nothing (login walls, sparse pages).
    try {
        const article = new Readability(document.cloneNode(true) as any).parse();
        if (article && article.content) {
            // article.content is an HTML fragment of just the article — re-parse
            // it so domToMarkdown walks a clean tree.
            const { document: artDoc } = parseHTML(article.content);
            const md = domToMarkdown(artDoc.body || artDoc.documentElement, baseUrl);
            const cleaned = cleanMd(md);
            if (cleaned.trim()) return cleaned;
        }
    } catch { /* fall through to manual extraction */ }

    // Manual fallback: strip boilerplate blocks, prefer <article>/<main>/<body>.
    for (const sel of ['script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside', 'svg', 'template', 'form']) {
        document.querySelectorAll(sel).forEach((el: any) => el.remove());
    }
    const root = document.querySelector('article') || document.querySelector('main') || document.body || document.documentElement;
    return cleanMd(domToMarkdown(root, baseUrl));
}

// Collapse the whitespace noise HTML indentation leaves behind — but line-wise
// and fence-aware, so indentation INSIDE ``` blocks (a <pre>) survives.
function cleanMd(md: string): string {
    const out: string[] = [];
    let inFence = false;
    for (const line of md.split('\n')) {
        if (line.trim().startsWith('```')) { inFence = !inFence; out.push(line); continue; }
        if (inFence) { out.push(line); continue; }  // keep code indentation
        out.push(line.replace(/[ \t]+/g, ' ').trim());
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim(); // collapse blank-line runs
}

registry.register({
    name: 'WebFetch',
    description:
        'Fetch a web page and return its content as clean Markdown (headings, links, lists, code, tables preserved; nav/footer/ads stripped). ' +
        'This reads the page server-side WITHOUT launching the browser — use it to look up a fact, scrape an article, or get a price/number from a URL. ' +
        'Only fall back to browser_navigate + browser_snapshot when the page needs JavaScript to render or WebFetch returns empty/blocked.',
    schema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'URL to fetch' },
            format: { type: 'string', enum: ['text', 'html'], description: 'Return format: text (default, Markdown) or html (raw).' },
        },
        required: ['url'],
    },
    handler: async (args, _context) => {
        try {
            const response = await fetch(args.url, {
                headers: {
                    'User-Agent': CHROME_UA,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                redirect: 'follow',
            });
            if (!response.ok) return `Error: HTTP ${response.status} ${response.statusText}`;
            const html = await response.text();
            if (args.format === 'html') return html.slice(0, MAX_CHARS);
            const md = extractMarkdown(html, response.url || args.url);
            if (!md.trim()) return 'Page fetched but no readable content found (the page may need JavaScript to render — try browser_navigate + browser_snapshot).';
            return md.length > MAX_CHARS ? md.slice(0, MAX_CHARS) + `\n[... truncated at ${MAX_CHARS} chars]` : md;
        } catch (err: any) {
            return `Error fetching URL: ${err.message}`;
        }
    },
    toolset: 'web',
    tier: 'public',
});