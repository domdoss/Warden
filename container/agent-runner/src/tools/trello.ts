// Trello — personal-assistant queries over the user's Trello boards. ONE merged
// action tool (the iris/project pattern): `action` picks the operation. Reads
// credentials directly (process.env first, then data/env/env). All calls hit the
// Trello REST API over plain HTTPS. Credentials: TRELLO_API_KEY + TRELLO_TOKEN.
import { registry } from '../tool-registry.js';
import { readToken } from './ext-env.js';

const TRELLO_API = 'https://api.trello.com/1/';

async function trelloApi(pathname: string, params: Record<string, string> = {}): Promise<any> {
    const key = readToken('TRELLO_API_KEY');
    const token = readToken('TRELLO_TOKEN');
    if (!key || !token) return { error: 'unconfigured' };
    const url = new URL(pathname, TRELLO_API);
    url.searchParams.set('key', key);
    url.searchParams.set('token', token);
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(20_000) });
    return res.json().catch(() => ({ error: 'non-JSON response' }));
}

function fmtCard(c: any, i: number): string {
    const name = c.name || '(no name)';
    const due = c.due ? ` due ${c.due}` : '';
    const labels = Array.isArray(c.labels) && c.labels.length ? ` [${c.labels.map((l: any) => l.name).filter(Boolean).join(', ')}]` : '';
    return `${i + 1}. ${name}${labels}${due} (id ${c.id})`;
}

registry.register({
    name: 'trello',
    description: '{"what":"query the user\'s Trello boards and cards","how":"action picks the operation","answer":"the returned result text","actions":{"boards":"list the user\'s boards","lists":"lists in one board","cards":"cards in a list or board","search":"search boards and cards","get":"one card or board by id"}}',
    schema: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['boards', 'lists', 'cards', 'search', 'get'], description: '{"what":"the operation","vals":"boards|lists|cards|search|get"}' },
            board_id: { type: 'string', description: '{"what":"lists/cards: the board id"}' },
            list_id: { type: 'string', description: '{"what":"cards: the list id (cards in that list)"}' },
            id: { type: 'string', description: '{"what":"get: the card or board id"}' },
            query: { type: 'string', description: '{"what":"search: the search text"}' },
        },
        required: ['action'],
    },
    handler: async (args) => {
        const action = String(args.action || '');
        const key = readToken('TRELLO_API_KEY');
        const token = readToken('TRELLO_TOKEN');
        if (!key || !token) {
            return 'Trello is not configured (TRELLO_API_KEY and TRELLO_TOKEN are not set in data/env/env).';
        }

        if (action === 'boards') {
            const r = await trelloApi('members/me/boards', { fields: 'name,id,closed' });
            if (r.error) return `Trello board list failed: ${r.error}`;
            const boards = (Array.isArray(r) ? r : []).filter((b: any) => !b.closed);
            if (!boards.length) return 'No open Trello boards found.';
            return `Trello boards:\n${boards.map((b: any, i: number) => `${i + 1}. ${b.name} (id ${b.id})`).join('\n')}`;
        }

        if (action === 'lists') {
            const boardId = String(args.board_id || '');
            if (!boardId) return 'Trello lists needs a board_id.';
            const r = await trelloApi(`boards/${boardId}/lists`, { fields: 'name,id,closed' });
            if (r.error) return `Trello list fetch failed: ${r.error}`;
            const lists = (Array.isArray(r) ? r : []).filter((l: any) => !l.closed);
            if (!lists.length) return `No open lists in board ${boardId}.`;
            return `Trello lists in board ${boardId}:\n${lists.map((l: any, i: number) => `${i + 1}. ${l.name} (id ${l.id})`).join('\n')}`;
        }

        if (action === 'cards') {
            const boardId = String(args.board_id || '');
            const listId = String(args.list_id || '');
            if (!boardId && !listId) return 'Trello cards needs a board_id or list_id.';
            const path = listId ? `lists/${listId}/cards` : `boards/${boardId}/cards`;
            const r = await trelloApi(path);
            if (r.error) return `Trello card fetch failed: ${r.error}`;
            const cards = Array.isArray(r) ? r : [];
            if (!cards.length) return 'No Trello cards found.';
            return `Trello cards:\n${cards.map(fmtCard).join('\n')}`;
        }

        if (action === 'search') {
            const query = String(args.query || '').trim();
            if (!query) return 'Trello search needs a query.';
            const r = await trelloApi('search', { query, cards_limit: '30', boards_limit: '10' });
            if (r.error) return `Trello search failed: ${r.error}`;
            const cards = r.cards || [];
            const boards = r.boards || [];
            if (!cards.length && !boards.length) return `No Trello results for "${query}".`;
            const boardLines = boards.map((b: any, i: number) => `${i + 1}. [board] ${b.name} (id ${b.id})`);
            const cardLines = cards.map(fmtCard);
            return `Trello search for "${query}":\n${[...boardLines, ...cardLines].join('\n')}`;
        }

        if (action === 'get') {
            const id = String(args.id || '');
            if (!id) return 'Trello get needs an id.';
            const r = await trelloApi(`cards/${id}`, { fields: 'name,desc,due,url,labels' });
            if (r.error) return `Trello get failed: ${r.error}`;
            if (!r.id) return `No Trello card with id ${id}.`;
            return `Trello card: ${r.name}\n${r.desc || '(no description)'}\n${r.due ? `Due: ${r.due}\n` : ''}${r.url || ''}`;
        }

        return `Unknown trello action "${action}" — use boards, lists, cards, search, or get.`;
    },
    toolset: 'trello',
    tier: 'public',
});
