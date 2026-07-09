import { registry } from '../tool-registry.js';

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
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Prometheus/1.0)' },
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

registry.register({
    name: 'WebFetch',
    description: 'Fetch a web page and return its content.',
    schema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'URL to fetch' },
            format: { type: 'string', enum: ['text', 'html'], description: 'Return format (default text)' },
        },
        required: ['url'],
    },
    handler: async (args, _context) => {
        try {
            const response = await fetch(args.url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Prometheus/1.0)' },
                redirect: 'follow',
            });
            if (!response.ok) return `Error: HTTP ${response.status} ${response.statusText}`;
            const html = await response.text();
            if (args.format === 'html') return html.slice(0, 50000);
            const text = html
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            return text.slice(0, 50000) || 'Page fetched but no text content found.';
        } catch (err: any) {
            return `Error fetching URL: ${err.message}`;
        }
    },
    toolset: 'web',
    tier: 'public',
});
