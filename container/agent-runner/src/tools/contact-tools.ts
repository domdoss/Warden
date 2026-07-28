import { registry } from '../tool-registry.js';
import { writeCallbackAsync } from '../index.js';

async function callHost(tool: string, args: any, timeoutMs = 30000): Promise<any> {
    try {
        return await writeCallbackAsync(tool, args, timeoutMs);
    } catch (err: any) {
        return { ok: false, error: err?.message ?? String(err) };
    }
}

function summarize(contacts: any[]): string {
    if (contacts.length === 0) return 'No contacts found.';
    const lines = contacts.slice(0, 50).map((c: any, i: number) => {
        const email = (c.email && c.email[0]) ? ` <${c.email[0]}>` : '';
        const phone = (c.phone && c.phone[0]) ? ` ${c.phone[0]}` : '';
        return `${i + 1}. ${c.fullName || [c.givenName, c.familyName].filter(Boolean).join(' ')}${email}${phone} (uid ${c.uid})`;
    }).join('\n');
    return `${contacts.length} contacts:\n${lines}`;
}

registry.register({
    name: 'list_contacts',
    description: 'List contacts from the shared address book (CardDAV). Pass query to filter.',
    schema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Optional substring filter (name/email/phone/org)' } },
    },
    handler: async (args, _context) => {
        const resp = await callHost('list_contacts', { query: args.query }, 60000);
        if (resp?.ok) return summarize(resp.contacts || []);
        return `Contacts list failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'contacts',
    tier: 'private',
});

registry.register({
    name: 'search_contacts',
    description: 'Search the shared address book by name, email, phone, or organization.',
    schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    handler: async (args, _context) => {
        const resp = await callHost('search_contacts', { query: args.query }, 60000);
        if (resp?.ok) return summarize(resp.contacts || []);
        return `Contacts search failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'contacts',
    tier: 'private',
});

registry.register({
    name: 'get_contact',
    description: 'Get a single contact by uid.',
    schema: { type: 'object', properties: { uid: { type: 'string' } }, required: ['uid'] },
    handler: async (args, _context) => {
        const resp = await callHost('get_contact', { uid: args.uid });
        if (resp?.ok) return `Contact:\n${JSON.stringify(resp.contact, null, 2).slice(0, 4000)}`;
        return `Contact fetch failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'contacts',
    tier: 'private',
});

registry.register({
    name: 'create_contact',
    description: 'Create a contact in the shared address book. Visible in KAddressBook.',
    schema: {
        type: 'object',
        properties: {
            full_name: { type: 'string' }, given_name: { type: 'string' }, family_name: { type: 'string' },
            email: { type: 'array', items: { type: 'string' } },
            phone: { type: 'array', items: { type: 'string' } },
            org: { type: 'string' }, title: { type: 'string' }, note: { type: 'string' },
        },
        required: ['full_name'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('create_contact', {
            full_name: args.full_name, given_name: args.given_name, family_name: args.family_name,
            email: args.email, phone: args.phone, org: args.org, title: args.title, note: args.note,
        });
        if (resp?.ok) return `Contact "${args.full_name}" created (id ${resp.contactId}). Visible in KAddressBook.`;
        return `Contact create failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'contacts',
    tier: 'private',
});

registry.register({
    name: 'update_contact',
    description: 'Update an existing contact by uid. Only provided fields change.',
    schema: {
        type: 'object',
        properties: {
            uid: { type: 'string' }, full_name: { type: 'string' }, given_name: { type: 'string' },
            family_name: { type: 'string' }, email: { type: 'array', items: { type: 'string' } },
            phone: { type: 'array', items: { type: 'string' } },
            org: { type: 'string' }, title: { type: 'string' }, note: { type: 'string' },
        },
        required: ['uid'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('update_contact', {
            uid: args.uid, full_name: args.full_name, given_name: args.given_name, family_name: args.family_name,
            email: args.email, phone: args.phone, org: args.org, title: args.title, note: args.note,
        });
        if (resp?.ok) return `Contact ${args.uid} updated.`;
        return `Contact update failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'contacts',
    tier: 'private',
});

registry.register({
    name: 'delete_contact',
    description: 'Delete a contact by uid from the shared address book.',
    schema: { type: 'object', properties: { uid: { type: 'string' } }, required: ['uid'] },
    handler: async (args, _context) => {
        const resp = await callHost('delete_contact', { uid: args.uid });
        if (resp?.ok) return `Contact ${args.uid} deleted.`;
        return `Contact delete failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'contacts',
    tier: 'private',
});