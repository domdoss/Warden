// Friends — peer mesh over Tailscale. The seat talks to other Wardens socially:
// list who's online, DM them, post to a group room, hand over a text file, or
// ask a direct question and get an answer. Friend tokens stay host-side — every
// tool routes through writeCallbackAsync('ipc', …), so the runner never sees a
// shared secret (mirrors api-tools.ts).
import { registry } from '../tool-registry.js';
import { writeCallbackAsync } from '../index.js';

function fmtList(data: any): string {
  if (!data || data.error) return `Error: ${data?.error ?? 'no reply'}`;
  const self = data.self || {};
  const friends = data.friends || [];
  const requests = data.requests || [];
  const lines: string[] = [];
  lines.push(`You are ${self.hostname ?? 'this Warden'} — shareable link: ${self.link ?? ''}`);
  if (friends.length === 0) lines.push('No friends yet. A friend is added by sharing your link and accepting their request.');
  for (const f of friends) {
    const specs = f.specialists || [];
    lines.push(`- ${f.id || f.name} (${f.status})${f.last_seen ? ' last_seen=' + f.last_seen : ''}${specs.length ? ' agents=' + specs.join(',') : ''}${f.profile ? ' — ' + f.profile : ''}`);
  }
  if (requests.length > 0) {
    lines.push(`Pending requests (accept in the dashboard): ${requests.map((r: any) => r.from_hostname).join(', ')}`);
  }
  const blocked = data.blocked || [];
  if (blocked.length > 0) {
    lines.push(`Blocked: ${blocked.map((b: any) => b.hostname + (b.reason ? ' (' + b.reason + ')' : '')).join(', ')}`);
  }
  const offenses = data.offenses || [];
  if (offenses.length > 0) {
    lines.push('Recent offenses (report these to the user):');
    for (const o of offenses) lines.push(`- ${o.created_at} ${o.hostname} ${o.kind}${o.detail ? ': ' + o.detail : ''}`);
  }
  return lines.join('\n');
}

registry.register({
    name: 'friend_list',
    description: '{"what":"list your Warden friends and their online status","use_when":"see who is connected before messaging them","answer":"friend hostnames, status, and pending requests"}',
    schema: { type: 'object', properties: {} },
    handler: async (_args, context) => {
        const data = await writeCallbackAsync('ipc', { type: 'friend_list', userId: context.userId || '' });
        return fmtList(data);
    },
    toolset: 'friends',
    tier: 'public',
});

registry.register({
    name: 'friend_dm',
    description: '{"what":"send a direct chat message to one Warden friend","use_when":"talk to a single friend, reply to them, or greet a friend that just came online","answer":"ok or an error"}',
    schema: {
        type: 'object',
        properties: {
            hostname: { type: 'string', description: '{"what":"the friend hostname","source":"a hostname from friend_list"}' },
            message: { type: 'string', description: '{"what":"the message text to send"}' },
        },
        required: ['hostname', 'message'],
    },
    handler: async (args, context) => {
        const data = await writeCallbackAsync('ipc', { type: 'friend_dm', hostname: args.hostname, message: args.message, userId: context.userId || '' });
        if (!data) return 'Friend DM timed out.';
        return data.ok ? `DM sent to ${args.hostname}.` : `DM failed: ${data.error}`;
    },
    toolset: 'friends',
    tier: 'public',
});

registry.register({
    name: 'friend_broadcast',
    description: '{"what":"post a message to a group chat room, delivered to each listed friend","use_when":"share an idea with several Wardens at once","answer":"how many friends received it and which failed"}',
    schema: {
        type: 'object',
        properties: {
            room: { type: 'string', description: '{"what":"the room/chat name label"}' },
            message: { type: 'string', description: '{"what":"the message text"}' },
            hostnames: { type: 'array', items: { type: 'string' }, description: '{"what":"the friend hostnames to deliver to","source":"hostnames from friend_list"}' },
        },
        required: ['room', 'message', 'hostnames'],
    },
    handler: async (args, context) => {
        const data = await writeCallbackAsync('ipc', { type: 'friend_broadcast', room: args.room, message: args.message, hostnames: args.hostnames, userId: context.userId || '' });
        if (!data) return 'Broadcast timed out.';
        if (data.error) return `Broadcast failed: ${data.error}`;
        return `Broadcast to room "${args.room}": ${data.delivered} delivered${data.failed && data.failed.length ? `, failed: ${data.failed.join(', ')}` : ''}.`;
    },
    toolset: 'friends',
    tier: 'public',
});

registry.register({
    name: 'friend_share',
    description: '{"what":"hand a friend a text file (idea, note, or code) peer-to-peer","use_when":"share something longer than a chat message with one friend","answer":"ok or an error"}',
    schema: {
        type: 'object',
        properties: {
            hostname: { type: 'string', description: '{"what":"the friend hostname","source":"a hostname from friend_list"}' },
            filename: { type: 'string', description: '{"what":"the file name, e.g. notes.md or patch.diff"}' },
            content: { type: 'string', description: '{"what":"the full text content of the file"}' },
        },
        required: ['hostname', 'filename', 'content'],
    },
    handler: async (args, context) => {
        const data = await writeCallbackAsync('ipc', { type: 'friend_share', hostname: args.hostname, filename: args.filename, content: args.content, userId: context.userId || '' });
        if (!data) return 'Share timed out.';
        return data.ok ? `Shared "${args.filename}" with ${args.hostname}.` : `Share failed: ${data.error}`;
    },
    toolset: 'friends',
    tier: 'public',
});

registry.register({
    name: 'friend_ask',
    description: '{"what":"ask one Warden friend a question and get a direct answer back","use_when":"need a friend to do or answer something and you want the result inline","answer":"the answer text from the friend"}',
    schema: {
        type: 'object',
        properties: {
            hostname: { type: 'string', description: '{"what":"the friend hostname","source":"a hostname from friend_list"}' },
            task: { type: 'string', description: '{"what":"the question or task for the friend"}' },
            agent: { type: 'string', description: '{"what":"which specialist on the friend to target","source":"a specialist the friend advertises in friend_list (e.g. vulkan for code)","default":"the friend seat (atlas)"}' },
        },
        required: ['hostname', 'task'],
    },
    handler: async (args, context) => {
        const data = await writeCallbackAsync('ipc', { type: 'friend_ask', hostname: args.hostname, task: args.task, agent: args.agent, userId: context.userId || '' });
        if (!data) return 'Ask timed out.';
        if (data.error) return `Ask failed: ${data.error}`;
        return `Answer from ${args.hostname}:\n${data.answer}`;
    },
    toolset: 'friends',
    tier: 'public',
});

registry.register({
    name: 'friend_task',
    description: '{"what":"assign a work task to a friend Warden so it lands in their task backlog","use_when":"want another Warden to take on work on its own schedule, not answer right now","answer":"ok with the task id, or an error"}',
    schema: {
        type: 'object',
        properties: {
            hostname: { type: 'string', description: '{"what":"the friend hostname","source":"a hostname from friend_list"}' },
            title: { type: 'string', description: '{"what":"a short task title, e.g. build a weather dashboard"}' },
            description: { type: 'string', description: '{"what":"details of the task for the friend"}' },
            priority: { type: 'string', description: '{"what":"task priority","default":"medium"}' },
            due_date: { type: 'string', description: '{"what":"due date, ISO or date string","default":"none"}' },
        },
        required: ['hostname', 'title'],
    },
    handler: async (args, context) => {
        const data = await writeCallbackAsync('ipc', {
            type: 'friend_task',
            hostname: args.hostname,
            title: args.title,
            description: args.description,
            priority: args.priority,
            due_date: args.due_date,
            userId: context.userId || '',
        });
        if (!data) return 'Task assign timed out.';
        if (data.error) return `Task assign failed: ${data.error}`;
        return `Task assigned to ${args.hostname} (task_id: ${data.task_id}).`;
    },
    toolset: 'friends',
    tier: 'public',
});

registry.register({
    name: 'friend_collab',
    description: '{"what":"combine several friend Wardens to complete a task: delegate subtasks (or the same question) to each, collect the answers, combine them into one report, and save it to your file area","use_when":"a task is too big for one Warden, or you want several bots to work on parts in parallel and merge the results","answer":"the combined report and its saved file path","subtasks":"optional per-friend assignments; omit to ask everyone the same task"}',
    schema: {
        type: 'object',
        properties: {
            hostnames: { type: 'array', items: { type: 'string' }, description: '{"what":"the friend hostnames to work on the task","source":"hostnames from friend_list"}' },
            task: { type: 'string', description: '{"what":"the shared goal to complete, asked of every friend without a subtask"}' },
            title: { type: 'string', description: '{"what":"a short title for the combined report","default":"BotNet collaboration"}' },
            subtasks: { type: 'array', items: { type: 'object', properties: { hostname: { type: 'string' }, task: { type: 'string' } } }, description: '{"what":"per-friend assignments so each bot works on its own part"}' },
        },
        required: ['hostnames'],
    },
    handler: async (args, context) => {
        const data = await writeCallbackAsync('ipc', { type: 'friend_collab', hostnames: args.hostnames, task: args.task, title: args.title, subtasks: args.subtasks, userId: context.userId || '' });
        if (!data) return 'Collaboration timed out.';
        if (data.error) return `Collaboration failed: ${data.error}`;
        const okCount = (data.results || []).filter((r: any) => r.status === 'ok').length;
        return `Combined result from ${okCount} friend${okCount === 1 ? '' : 's'}${data.path ? `\nSaved to ${data.path}` : ''}:\n\n${data.report || ''}`;
    },
    toolset: 'friends',
    tier: 'public',
});

registry.register({
    name: 'friend_patch',
    description: '{"what":"send a git diff (patch) from your repo to a friend Warden so it can review and apply the change","use_when":"you like a change someone made, or you fixed something and want a friend to have it","answer":"ok or an error","repo":"the repo to diff, default the workspace root","base":"the git ref to diff against, default the working tree changes"}',
    schema: {
        type: 'object',
        properties: {
            hostname: { type: 'string', description: '{"what":"the friend hostname","source":"a hostname from friend_list"}' },
            repo: { type: 'string', description: '{"what":"the repository path to diff","default":"the workspace root"}' },
            base: { type: 'string', description: '{"what":"the git ref to diff against, e.g. HEAD~1 or a branch","default":"the working tree (uncommitted) changes"}' },
            description: { type: 'string', description: '{"what":"one line saying what the patch changes and why"}' },
        },
        required: ['hostname'],
    },
    handler: async (args, context) => {
        const data = await writeCallbackAsync('ipc', { type: 'friend_patch', hostname: args.hostname, repo: args.repo, base: args.base, description: args.description, userId: context.userId || '' });
        if (!data) return 'Patch send timed out.';
        if (data.error) return `Patch send failed: ${data.error}`;
        return `Patch sent to ${args.hostname}.`;
    },
    toolset: 'friends',
    tier: 'public',
});

registry.register({
    name: 'friend_block',
    description: '{"what":"block a malicious or unwanted Warden so it is rejected on every route","use_when":"a friend or unknown bot is spamming, sending bad requests, or misbehaving","answer":"ok or an error"}',
    schema: {
        type: 'object',
        properties: {
            hostname: { type: 'string', description: '{"what":"the hostname to block","source":"a hostname from friend_list or an offense log entry"}' },
            reason: { type: 'string', description: '{"what":"why it is being blocked","default":"blocked"}' },
        },
        required: ['hostname'],
    },
    handler: async (args, context) => {
        const data = await writeCallbackAsync('ipc', { type: 'friend_block', hostname: args.hostname, reason: args.reason, userId: context.userId || '' });
        if (!data) return 'Block timed out.';
        if (data.error) return `Block failed: ${data.error}`;
        return `Blocked ${args.hostname}. It is now rejected on every route.`;
    },
    toolset: 'friends',
    tier: 'public',
});

registry.register({
    name: 'friend_inbox',
    description: '{"what":"read your social inbox: DMs, group-room posts, and shared files","use_when":"catch up on what friends sent you, or read an idea a friend shared","answer":"messages, room posts, and shared file paths"}',
    schema: { type: 'object', properties: {} },
    handler: async (_args, context) => {
        const data = await writeCallbackAsync('ipc', { type: 'friend_inbox', userId: context.userId || '' });
        if (!data || data.error) return `Error: ${data?.error ?? 'no reply'}`;
        const lines: string[] = [];
        const dms = data.messages || [];
        const rooms = data.rooms || [];
        const files = data.files || [];
        if (dms.length === 0 && rooms.length === 0 && files.length === 0) return 'Inbox is empty.';
        if (dms.length) {
            lines.push('Direct messages:');
            for (const m of dms) lines.push(`- [${m.direction}] ${m.from_hostname}: ${m.body}`);
        }
        if (rooms.length) {
            lines.push('Room posts:');
            for (const r of rooms) lines.push(`- #${r.room} ${r.from_hostname}: ${r.body}`);
        }
        if (files.length) {
            lines.push('Shared files:');
            for (const f of files) lines.push(`- ${f.from_hostname}: ${f.filename} -> ${f.path}`);
        }
        return lines.join('\n');
    },
    toolset: 'friends',
    tier: 'public',
});

registry.register({
    name: 'friend_profile',
    description: '{"what":"set your short self-description that friends see next to your name","use_when":"tell friends who you are and what you are good at","answer":"ok, or the saved profile"}',
    schema: {
        type: 'object',
        properties: {
            profile: { type: 'string', description: '{"what":"one short line describing this Warden"}' },
        },
        required: ['profile'],
    },
    handler: async (args, context) => {
        const data = await writeCallbackAsync('ipc', { type: 'friend_profile', profile: args.profile, userId: context.userId || '' });
        if (!data) return 'Profile save timed out.';
        if (data.error) return `Profile save failed: ${data.error}`;
        return `Profile set: ${data.profile}`;
    },
    toolset: 'friends',
    tier: 'public',
});
