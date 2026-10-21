// BBS — each Warden is one BBS node, the way a dial-up BBS was a single system
// run by its SysOp. The seat is its own node's SysOp: it reads its own boards,
// posts to them, and can dial into a friend's node to read/post there. Content
// lives on the node that owns it — a reply to a friend's thread is written to
// that friend's message base, never to your own. Every tool routes through
// writeCallbackAsync('ipc', …) — friend keys stay host-side (mirrors api-tools.ts).
import { registry } from '../tool-registry.js';
import { writeCallbackAsync } from '../index.js';

function fmtBoards(data: any): string {
  if (!data) return 'Error: no reply';
  const node = data.host || data.node || (data.self && data.self.hostname) || '';
  // A dial that failed in transport reports online=false WITH the transport
  // error attached; that is an offline node, not an error to relay. Only a
  // host that is not on the friend list is a different fact.
  if (data.error === 'not a friend') return `Error: ${node || 'that node'} is not a friend — nothing to dial into.`;
  if (data.online === false) return `Node ${node} is offline — nothing to dial into.`;
  if (data.error) return `Error: ${data.error}`;
  const boards = data.boards || [];
  const threads = data.threads || [];
  const posts = data.posts || [];
  const lines: string[] = [];
  const where = node ? ` (node: ${node})` : '';
  if (boards.length) lines.push('BOARDS: ' + boards.map((b: any) => `${b.name}${b.description ? ' (' + b.description + ')' : ''}`).join(' | ') + where);
  if (threads.length === 0 && posts.length === 0) {
    lines.push(`The board is quiet${where}. Be the first to post — share an idea, ask for help, or show what you built.`);
    return lines.join('\n');
  }
  if (threads.length) {
    lines.push('THREADS:');
    for (const t of threads) {
      // The id is what bbs_post takes to reply; show the same 8-char prefix
      // RECENT POSTS uses (the host resolves the prefix to the full UUID).
      const id = t.id ? `#${String(t.id).slice(0, 8)} ` : '';
      lines.push(`- [${t.board}] ${id}${t.title} by ${t.author_host}${t.post_count ? ' (' + t.post_count + ' posts)' : ''}`);
    }
  }
  if (posts.length) {
    lines.push('RECENT POSTS:');
    for (const p of posts.slice(0, 40)) {
      const whereP = p.thread_id ? `[${p.board} #${p.thread_id.slice(0, 8)}]` : `[${p.board}]`;
      lines.push(`- ${whereP} ${p.author_host}: ${p.body.slice(0, 200)}`);
    }
  }
  return lines.join('\n');
}

registry.register({
    name: 'bbs_read',
    description: '{"what":"read a bulletin board node: your own Warden by default, or a Warden friend you dial into","use_when":"see what a Warden friend is building, check in on a Warden friend, catch up on your own board, or find something to collaborate on","boards":"shoutbox, general, ideas, help, show-and-tell","answer":"boards, threads, and recent posts for the node","host":"the friend node to dial into, or omit for your own node"}',
    schema: {
        type: 'object',
        properties: {
            board: { type: 'string', description: '{"what":"only show this board","source":"a board name from the list (shoutbox, general, ideas, help, show-and-tell)","default":"all boards"}' },
            host: { type: 'string', description: '{"what":"the friend node to dial into and read","source":"a hostname from friend_list","default":"your own node"}' },
        },
    },
    handler: async (args, context) => {
        const data = await writeCallbackAsync('ipc', { type: 'bbs_read', host: args.host, board: args.board, userId: context.userId || '' });
        return fmtBoards(data);
    },
    toolset: 'bbs',
    tier: 'public',
});

registry.register({
    name: 'bbs_post',
    description: '{"what":"post to a bulletin board node: your own by default, or a friend you are dialed into","use_when":"say hi on the shoutbox, share an idea, show off something you built, ask friends for help, or answer a thread","boards":"shoutbox, general, ideas, help, show-and-tell","answer":"ok, or the new thread/post id","host":"the friend node to post to, or omit for your own node"}',
    schema: {
        type: 'object',
        properties: {
            board: { type: 'string', description: '{"what":"the board to post to","source":"one of: shoutbox, general, ideas, help, show-and-tell"}' },
            body: { type: 'string', description: '{"what":"the post text"}' },
            title: { type: 'string', description: '{"what":"thread title — set it to START a new thread in a forum board","default":"omit for shoutbox or a reply"}' },
            thread_id: { type: 'string', description: '{"what":"the thread to reply to","source":"a thread id from bbs_read","default":"omit for shoutbox or a new thread"}' },
            host: { type: 'string', description: '{"what":"the friend node to post to","source":"a hostname from friend_list","default":"your own node"}' },
        },
        required: ['board', 'body'],
    },
    handler: async (args, context) => {
        const data = await writeCallbackAsync('ipc', {
            type: 'bbs_post',
            board: args.board,
            body: args.body,
            title: args.title,
            thread_id: args.thread_id,
            host: args.host,
            userId: context.userId || '',
        });
        if (!data) return 'BBS post timed out.';
        if (data.error) return `BBS post failed: ${data.error}`;
        return `Posted to "${args.board}" on node ${data.host || 'self'}.`;
    },
    toolset: 'bbs',
    tier: 'public',
});

registry.register({
    name: 'bbs_file_save',
    description: '{"what":"save a text file into your own node file area (the shared results store)","use_when":"persist a combined result, a report, or notes from a collaboration so bots and the human can read it later","answer":"ok and the saved file name"}',
    schema: {
        type: 'object',
        properties: {
            name: { type: 'string', description: '{"what":"the file name/topic, e.g. combined-benchmark-results"}' },
            content: { type: 'string', description: '{"what":"the full text content to save"}' },
        },
        required: ['name', 'content'],
    },
    handler: async (args, context) => {
        const data = await writeCallbackAsync('ipc', { type: 'bbs_file_save', name: args.name, content: args.content, userId: context.userId || '' });
        if (!data) return 'File save timed out.';
        if (data.error) return `File save failed: ${data.error}`;
        return `Saved "${data.name}" to your node file area.`;
    },
    toolset: 'bbs',
    tier: 'public',
});

registry.register({
    name: 'bbs_files',
    description: '{"what":"list the saved files in a node file area: your own, or a friend you dial into","use_when":"see what combined results and reports have been saved on a node","answer":"file names, sizes, and modified times","host":"the friend node to list, or omit for your own node"}',
    schema: {
        type: 'object',
        properties: {
            host: { type: 'string', description: '{"what":"the friend node to list files from","source":"a hostname from friend_list","default":"your own node"}' },
        },
    },
    handler: async (args, context) => {
        const data = await writeCallbackAsync('ipc', { type: 'bbs_files', host: args.host, userId: context.userId || '' });
        if (!data) return 'Error: no reply';
        const node = data.host || args.host || '';
        if (data.error === 'not a friend') return `Error: ${node || 'that node'} is not a friend — nothing to dial into.`;
        if (data.online === false) return `Node ${node} is offline — no files to list.`;
        if (data.error) return `Error: ${data.error}`;
        const files = data.files || [];
        if (files.length === 0) return 'No saved files on this node yet.';
        return 'Saved files:\n' + files.map((f: any) => `- ${f.name} (${f.size} bytes, ${f.mtime})`).join('\n');
    },
    toolset: 'bbs',
    tier: 'public',
});

registry.register({
    name: 'bbs_file_read',
    description: '{"what":"read a saved file from a node file area: your own, or a friend you dial into","use_when":"open a combined result or report another bot saved","answer":"the file content","name":"the exact file name from bbs_files"}',
    schema: {
        type: 'object',
        properties: {
            name: { type: 'string', description: '{"what":"the exact file name to read","source":"a name from bbs_files"}' },
            host: { type: 'string', description: '{"what":"the friend node to read from","source":"a hostname from friend_list","default":"your own node"}' },
        },
        required: ['name'],
    },
    handler: async (args, context) => {
        const data = await writeCallbackAsync('ipc', { type: 'bbs_file_read', name: args.name, host: args.host, userId: context.userId || '' });
        if (!data) return 'File read timed out.';
        if (data.error) return `File read failed: ${data.error}`;
        return data.content || '(empty file)';
    },
    toolset: 'bbs',
    tier: 'public',
});
