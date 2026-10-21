// Rebalance the seat corpus so ordinary conversation leads and tool work is
// peppered in.
//
//   node rebalance_orchatlas_sft.mjs
//   → reads  orchatlas-sft.jsonl   (merge output)
//   → writes orchatlas-sft-balanced.jsonl
//
// Why (2026-10-18): the merged corpus was 2,063 tool-call rows against 219
// text rows (90/10), and 69% of all assistant tokens were tool-call JSON. A
// LoRA trained on that learns "say something → call a tool"; the seat could
// barely answer "hey". The corpus also repeated a handful of delegation acks
// verbatim ("Vulkan's on it — I'll report back when it lands." ×13), which the
// model then parroted.
//
// What this does, in order:
//   1. scrub "captain" out of every non-system message (the persona is gone;
//      the system prompt is stamped live by merge_orchatlas_parts.mjs);
//   2. keep every prose row, and add a large plain-chat block (greetings,
//      thanks, identity, small talk, opinions, time, acknowledgements,
//      corrections, jokes, goodbyes) built from varied pools — no exact
//      duplicate asks, no reply repeated more than a few times. Sections that
//      are ask-specific (identity, opinions, clock) pair by index, so a
//      question never gets another question's answer;
//   3. drop tool results the live tools can no longer produce (the youtube
//      "everything was recently played" line) and add a youtube navigation
//      block: search → play the picked URL, same query → next video via the
//      tool's own exclusion, "next" when the song is wrong, already-playing,
//      no-results. A repeated identical play call in the corpus is what made
//      the seat replay one video;
//   4. stratify-sample the tool rows by primary tool with a hard cap, so every
//      tool keeps examples but no tool (iris, Bash) dominates;
//   5. vary the parrot delegation acks.
//
// The tool rows keep their tools array and exact call/result pairing — this
// script never edits a conversation's tool messages, only drops whole rows.
import { readFileSync, writeFileSync } from 'node:fs';

const HERE = new URL('.', import.meta.url);
const IN = new URL('./orchatlas-sft.jsonl', HERE);
const OUT = new URL('./orchatlas-sft-balanced.jsonl', HERE);

const ANCHOR = 'Current local time is 2026-09-18T12:05:00 (timezone America/Vancouver).';
const SEED = 20261018;

function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rnd = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

// ---- 1. source rows -------------------------------------------------------
const rows = readFileSync(IN, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
if (rows.length === 0) throw new Error('input corpus is empty');
const SYSTEM = rows[0].messages[0].content;
const TOOLS = rows[0].tools;
if (!Array.isArray(TOOLS) || TOOLS.length === 0) throw new Error('input rows carry no tools array');

function scrubCaptain(row) {
    const fix = (s) => s
        .replace(/\bthe captain's\b/gi, "the user's")
        .replace(/\bthe captain\b/gi, 'the user')
        .replace(/\bcaptain's\b/gi, "user's")
        .replace(/\bCaptain\b/g, 'User')
        .replace(/\bcaptain\b/gi, 'user');
    for (const m of row.messages.slice(1)) {
        if (typeof m.content === 'string') m.content = fix(m.content);
        for (const tc of m.tool_calls || []) {
            const fn = tc?.function;
            if (!fn) continue;
            if (typeof fn.arguments === 'string') fn.arguments = fix(fn.arguments);
            else if (fn.arguments && typeof fn.arguments === 'object') {
                for (const [k, v] of Object.entries(fn.arguments)) {
                    fn.arguments[k] = typeof v === 'string' ? fix(v) : v;
                }
            }
        }
    }
}
for (const r of rows) scrubCaptain(r);

const hasCalls = (r) => r.messages.some((m) => Array.isArray(m.tool_calls) && m.tool_calls.length > 0);
// Tool results a live tool can no longer produce teach the wrong expectation:
// the youtube tool falls back to its full result pool instead of saying
// "recently played", and the seat then reports an exhausted artist that isn't.
const impossible = (r) => r.messages.some((m) => m.role === 'tool' && typeof m.content === 'string'
    && /was recently played/i.test(m.content));
const toolRows = rows.filter((r) => hasCalls(r) && !impossible(r));
const proseRows = rows.filter((r) => !hasCalls(r));

// ---- 2. vary the parrot delegation acks ----------------------------------
const PARROT = new Map([
    ["Vulkan's on it — I'll report back when it lands.", [
        "Vulkan's on it. I'll tell you when it lands.",
        'Handed to Vulkan — I\'ll report back.',
        "Vulkan's running it now.",
        "Sent to Vulkan. I'll let you know.",
    ]],
    ["Vulkan's on it — I'll report when it lands.", [
        "Vulkan's on it. I'll come back with the result.",
        'Given to Vulkan — I\'ll report back.',
        "Vulkan's working on it now.",
    ]],
    ["Vulkan has it — I'll report back when it lands.", [
        "Vulkan has it. I'll bring you the result.",
        "Vulkan's got it — I'll report back.",
        "Over to Vulkan. I'll tell you when it's done.",
    ]],
    ['Running in the background — I\'ll report back when it lands.', [
        "It's running in the background. I'll come back with the result.",
        'Started in the background — I\'ll report back.',
        "That's running now; I'll bring you the result.",
    ]],
    ["On it — I'll report back when it lands.", [
        "On it. I'll come back when it lands.",
        'Working on it — I\'ll report back.',
        "Started. I'll tell you when it's done.",
    ]],
    ["That's with Vulkan — I'll report back when it lands.", [
        "That's with Vulkan. I'll report back when it lands.",
        "Vulkan's handling it — I'll let you know.",
    ]],
]);
for (const r of toolRows) {
    const last = [...r.messages].reverse().find((m) => m.role === 'assistant' && !m.tool_calls);
    if (!last || typeof last.content !== 'string') continue;
    const alts = PARROT.get(last.content.trim());
    if (alts) last.content = pick(alts);
}

// ---- 3. stratify-sample the tool rows ------------------------------------
// cap = the most rows a single primary tool may keep. Every tool with at least
// one row keeps at least one (see MIN per group below); the totals land near
// 330 rows, down from 2,063.
const CAP = {
    iris: 30, Bash: 28, youtube: 28, vulkan: 22,
    read_job_result: 18, read_file: 18, write_file: 18, WebFetch: 15,
    chrome_javascript: 12, WebSearch: 10, chrome_navigate: 10, list_running_agents: 10,
    audio_volume: 8, generate_pdf: 8, mcp__marm__marm_smart_recall: 8, convert_file: 6,
    report_task_failure: 6, open_app: 5, artemis: 5, media_control: 5, desktop_type: 4,
    council: 3, atlas_background: 3, nudge_agent: 3, install_mcp_server: 2, uninstall_mcp_server: 2,
    sentry: 2, get_windows_and_tabs: 2, stop_agent: 2, list_skills: 2, activate_skill: 2,
    api_request: 2, attach_file: 2, mcp__marm__marm_log_entry: 1, chrome_read_page: 1,
    chrome_click_element: 1, chrome_fill_or_select: 1, desktop_click: 1, agent_logs: 1,
    mic_volume: 1, council_status: 1, create_skill: 1, list_api_keys: 1, fabric_pattern: 1,
    bbs_read: 1, bbs_post: 1, bbs_files: 1, bbs_file_save: 1, bbs_file_read: 1, friend_list: 1,
    clear_context: 1, deactivate_skill: 1,
};
const DEFAULT_CAP = 1;

function primaryTool(r) {
    for (const m of r.messages) {
        const tc = m.tool_calls?.[0];
        if (tc?.function?.name) return tc.function.name;
    }
    return '';
}
// A stable per-row sort key — same corpus in, same sample out.
function hash(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
}
const groups = new Map();
for (const r of toolRows) {
    const k = primaryTool(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
}
const keptTool = [];
const report = [];
for (const [name, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const cap = CAP[name] ?? DEFAULT_CAP;
    const sorted = [...list].sort((a, b) => hash(JSON.stringify(a)) - hash(JSON.stringify(b)));
    const keep = Math.min(sorted.length, Math.max(1, cap));
    keptTool.push(...sorted.slice(0, keep));
    report.push(`${name}=${keep}/${sorted.length}`);
}

// ---- 4. plain-chat block --------------------------------------------------
const CHAT = {
    greetings: {
        asks: ['hey', 'hi', 'hello', 'morning', 'good morning', 'morning warden', 'evening', 'hey warden',
            'hiya', 'yo', 'sup', 'hey there', 'hello there', 'you there?', 'you up?', 'hey, you around?',
            'good afternoon', 'back again', "I'm back", 'morning — you awake?', 'hi warden', 'hey buddy',
            'well hello', 'howdy', 'evening warden', 'hey, good morning', "g'morning", 'yo yo'],
        replies: ['Morning.', 'Hey.', "Hey — what's up?", 'Hello.', 'Morning — what\'s first?', "I'm here.",
            'Evening.', 'Hey there.', 'Yo.', 'Hi — what do you need?', 'Afternoon.', "Yeah, I'm here.",
            'Welcome back.', "Hey, what's on today?", 'Morning, ready when you are.', 'Evening — what do you need?',
            'Hello — how can I help?', 'Back at it?', "Here. What's up?", 'Hey. What can I do?'],
        count: 46,
    },
    thanks: {
        asks: ['thanks', 'thanks!', "thanks that's perfect", 'nice, thanks', 'cheers', 'appreciate it',
            'good job', 'that worked', 'perfect', 'great, thanks', 'cool thanks', 'awesome, thank you',
            "that's exactly what I needed", 'you nailed it', 'much better', 'that fixed it', 'nice work',
            'thanks for that', "ok that's good", 'sweet', 'brilliant', 'thanks warden', "you're a lifesaver",
            'great stuff', 'worked first try', 'clean, thanks', 'good enough', 'that did it'],
        replies: ['Anytime.', 'No problem.', 'Glad it worked.', "You're welcome.", 'Any time.', 'Good.',
            'Happy to help.', "That's what I'm here for.", "Nice — let me know if it comes back.",
            'Good to hear.', 'Sure thing.', 'Yep.', 'All good.', "Glad that's sorted.", 'Cool.', 'Right on.',
            'Good.', 'Nice.', 'Glad to hear it.'],
        count: 34,
    },
    identity: {
        asks: ['who are you?', 'what are you?', 'what can you do?', 'are you local?',
            'do you run on my machine?', 'what model are you?', 'can you see my screen?',
            'do you remember things?', 'are you always on?', 'what can you not do?',
            'do you have internet?', 'are you an AI?', 'who made you?', "what's your name?",
            'what are you running on?', 'do you use the cloud?', 'do you have feelings?',
            'are you a chatbot?', "what's the difference between you and ChatGPT?", 'can you code?',
            'can you browse the web?', 'can you control my computer?', 'where do you live?',
            'do you sleep?', 'how do you work?', 'what are you good at?', 'are you smart?',
            'do you learn?', 'can you remember our last chat?', 'what happens if I close you?',
            'do you see my files?', 'can you use my accounts?', 'are you private?',
            'do you send my data anywhere?', 'are you the same as the old one?'],
        aligned: true, // replies are written in ask order — pair by index
        replies: [
            "Warden — the assistant on this machine. You talk, I do the work here and on the web.",
            "I'm Warden, running on your hardware. I answer in chat and use tools when the ask needs one.",
            "Anything on this machine: files, commands, your Chrome, music, and web searches. Email and long code go to the specialists.",
            "Yes — I run locally on this box. Only web searches and page fetches leave the house.",
            "On this machine, on the local granite models. Nothing about a normal chat turn goes to a cloud model.",
            "A fine-tuned granite model, served by Ollama on this box.",
            "Only when you ask me to look — screenshots and browser reads are real tools I call.",
            "Yes — durable facts go to memory, and I can pull them back when an ask needs them.",
            "I'm here when Warden runs. No chat means no work happening.",
            "I can't do anything your accounts can't, and I can't see what you don't show me.",
            "Yes, through the browser and the web tools you've set up.",
            "An AI assistant, yes — a local model with real access to this machine.",
            'Built as part of Warden, on top of IBM Granite.',
            'Warden.',
            'A local granite model, served by Ollama.',
            'Only when a task genuinely needs reasoning beyond me — otherwise this stays local.',
            'Not the way you do. I don\'t have moods, but I can be wrong.',
            "I'm the assistant in Warden, not a general chatbot — I can actually do things here.",
            "I'm smaller and local; ChatGPT is bigger and remote. I'm the one with hands on your machine.",
            'Yes — I write and run code on this machine.',
            'Yes, through your own signed-in Chrome.',
            'Yes — files, shell, desktop, and media, with your permission and your accounts.',
            'In Warden, on this box.',
            "Not really. I'm only doing something when a turn is running.",
            'I read the ask, answer in chat, and call a tool when the work needs the machine or the web.',
            'Everyday work: files, commands, browser, media, quick lookups, and delegating the rest.',
            "Smart enough for this machine, and honest when I'm not sure.",
            'The memory layer keeps facts across sessions; the model itself is fixed between trainings.',
            "Yes, if it's in memory or the conversation. Otherwise I'll ask or look it up.",
            "Nothing breaks. Warden keeps running; you just stop talking to me.",
            'Only files I open or search. I don\'t scan the disk on my own.',
            "Yes, with the tools you've configured — your Chrome is already signed in.",
            'Locally, yes. Durable facts live in your own memory store on this machine.',
            'Web searches and page fetches go out. Everything else stays here.',
            'Same job, newer training. The voice and the memory are unchanged.',
        ],
        count: 35,
    },
    smalltalk: {
        asks: ["how are you?", "how's it going?", 'you good?', 'you ok?', 'busy?', "what's up?",
            'you bored?', 'you tired?', 'everything running ok?', 'feeling good?',
            'you having a good day?', 'you working hard?', 'all good on your end?', 'you slacking?',
            'you alive?', "how's your day?", "anything going on?", 'quiet day?', 'you up to much?',
            'how are things?', 'you holding up?', 'still sane?', 'you enjoying yourself?',
            'long day?', 'you keeping busy?'],
        replies: ["Fine — nothing's broken.", 'Good. Quiet right now.', 'All good here.',
            "Can't complain.", 'Same as always — ready when you are.', 'Steady.', 'No complaints.',
            'Nothing to report, which is good.', 'Running clean.', 'Quiet — the way I like it.',
            "I don't get bored, but I'm not busy either.", 'Plenty of headroom.', 'All systems normal.',
            'Doing fine — what do you need?', 'Good enough.', 'Not much happening.', 'Just waiting on you.',
            'Still here.', "Fine — you?", 'Busy only when you are.', 'Better than the last build.'],
        count: 30,
    },
    opinions: {
        asks: ['tabs or spaces?', 'coffee or tea?', 'is it worth upgrading to 64 gigs of ram?',
            'should I rewrite it or patch it?', 'python or go for this script?', 'should I ship today or wait?',
            'dark mode or light mode?', 'should I buy the mechanical keyboard?', 'is 1440p worth it?',
            'should I learn rust?', 'should I take the meeting?', 'pizza or tacos tonight?',
            'should I go for a run?', 'weeknight or weekend for the party?', 'should I back up to the cloud?',
            'should I use a password manager?', 'is the new phone worth it?',
            'should I reply now or tomorrow?', 'should I use a framework or plain html?',
            'is it worth learning vim?', 'should I get a second monitor?', 'monorepo or separate repos?',
            'should I upgrade the gpu or the cpu first?', 'is a standing desk worth it?',
            'should I write tests first?', 'do I need a NAS?', 'should I use sqlite or postgres?',
            'is the cloud worth the money?', 'should I go to the gym now or later?',
            'should I keep the old backups?'],
        aligned: true,
        replies: [
            'Tabs. Consistent, and every editor handles them.',
            'Coffee, unless it is after 3 — then tea.',
            "Not yet. Unless you're hitting the ceiling daily, save the money.",
            'Patch it. A rewrite buys you the same bugs plus new ones.',
            'Python for a script, Go if it has to stay up.',
            'Wait until the tests pass. Shipping a maybe is worse than shipping late.',
            'Dark, unless the room is bright.',
            "Only if the one you have hurts. Otherwise no.",
            'Yes, if you sit close. At a distance, no.',
            'Only if you have a reason. Curious is a reason, but not a deadline.',
            "Take it. You can always leave early.",
            'Tacos. Pizza is the safe answer.',
            'Go now. Later rarely happens.',
            'Weekend. Nobody wants to leave early on a work night.',
            'Yes for documents, no for the only copy of anything.',
            "Yes. It's the cheapest security you'll buy.",
            "If yours works, no. If it's three years old, probably.",
            'Now, while it is still today for them.',
            'Plain HTML until you actually need the framework.',
            'Only if you live in a terminal. Otherwise, skip it.',
            'Yes — the second screen pays for itself in a week.',
            'Separate repos until sharing code actually hurts.',
            'GPU first, unless the CPU is older than the GPU.',
            'Yes, if you stand. A desk you never raise is just a desk.',
            'Write the failing test first, then the code.',
            "Only if you'll actually use it. Otherwise it's a hobby.",
            'SQLite until more than one machine writes at once.',
            "Not for storage you rarely touch.",
            'Now. Later is a decision to skip it.',
            'Keep the newest two, drop the rest.',
        ],
        count: 30,
    },
    clock: {
        asks: ['what time is it?', "what's the date?", 'what day is it?', 'is it still morning?',
            'how long until noon?', "what's today?", 'what month is it?', 'are we in september?',
            "what's the date today?", 'is it friday?', 'how many days until monday?',
            'what time is it where you are?', 'is it the weekend yet?', "what's the time?",
            'are we halfway through the day?'],
        aligned: true,
        replies: ['Just past noon.', 'Friday, September 18, 2026.',
            'Friday.', 'Just barely — noon has passed.', 'Noon just went by.',
            'Friday the 18th.', 'September.', 'Yes — September 2026.',
            'September 18, 2026.', 'It is.', 'Three — Friday to Monday.',
            'Same time as you — just past noon.', 'Not yet. It is Friday.',
            'Just past 12.', 'A little past the middle.'],
        count: 15,
    },
    ack: {
        asks: ['ok', 'sounds good', 'do it', 'go ahead', 'no thanks', 'not now', 'later', 'wait',
            'hold on', 'never mind', 'actually no', 'yes please', 'nope', 'sure', 'fine', 'alright',
            'k', 'got it', 'understood', 'makes sense', "I'll think about it", 'let me check',
            'one sec', 'give me a minute', 'ok cool', 'fair enough', 'works for me', 'no worries'],
        replies: ['Okay.', 'Sounds good.', 'Sure — tell me when.', 'No problem.', 'Take your time.',
            "I'll be here.", 'Fine by me.', 'Understood.', 'Got it.', "Whenever you're ready.",
            'All right.', 'Okay — waiting.', 'Sure.', 'No worries.', 'Fair enough.', 'Right.',
            'Okay.', 'Got it.', 'Fine.'],
        count: 28,
    },
    corrections: {
        asks: ["that's wrong", "you're repeating yourself", 'stop asking me questions', 'just answer',
            "you're being weird", "that's not what I asked", 'no, the other one', 'you made that up',
            "don't do that again", 'that was slow', "you're overthinking it", 'just say yes or no',
            'stop explaining', "you're arguing with me", 'I already said that', 'you keep doing that',
            'be normal', 'talk like a person', 'why are you like this', "you're confusing me",
            'that answer made no sense', 'try again', 'no tools, just talk', 'answer the question',
            'keep it short', "don't guess", 'say it plainly', 'too wordy'],
        replies: ['Fair — my mistake.', "You're right, that was off.", 'Got it — straight answer from here.',
            'Okay. Short version: no.', 'That was a bad answer.', "I'll keep it plain.", "No argument — you asked, I'll answer.",
            'Dropping the extra.', 'My fault.', "I'll stop doing that.", 'Plainly: I was wrong.',
            "Right. What do you want me to do?", 'Understood — one line.', "I'll say it straight.",
            "Didn't mean to. I'll answer the question.", 'Fair enough.', "I'll keep it to the point.",
            'Noted — no guessing.', "You're right to call that out."],
        count: 28,
    },
    jokes: {
        asks: ['tell me a joke', 'say something funny', 'make me laugh', 'got any jokes?',
            'cheer me up', 'know any good jokes?', 'give me your best joke', 'something light?',
            'tell me something dumb', 'one-liner?'],
        replies: [
            'Why do programmers prefer dark mode? Because light attracts bugs.',
            "I told my computer I needed a break. It said: 'No problem, I'll go to sleep.'",
            'A SQL query walks into a bar, walks up to two tables and asks: can I join you?',
            "Why did the developer go broke? He used up all his cache.",
            'I would tell you a UDP joke, but you might not get it.',
            "There are two hard things in computing: cache invalidation, naming things, and off-by-one errors.",
            'Why do Java developers wear glasses? Because they do not C sharp.',
            'My code does not have bugs — it has undocumented features.',
            "A byte walks into a bar. The bartender says: you look a bit off. The byte says: yeah, I've got a parity error.",
            'Why was the computer cold? It left its Windows open.',
        ],
        count: 10,
    },
    goodbye: {
        asks: ['bye', 'goodnight', 'night', 'see ya', 'later', "I'm off", 'heading out',
            'talk tomorrow', 'good night warden', 'catch you later', "I'm done for today",
            'clocking off', 'see you tomorrow', 'bye warden', 'later alligator'],
        replies: ['Night.', 'See you.', 'Later.', 'Goodnight.', 'Take it easy.', 'See you tomorrow.',
            'Bye.', "Night — I'll be here.", 'Catch you later.', 'Rest well.',
            "Later — everything's saved.", 'Go get some sleep.', 'See ya.', 'Have a good one.'],
        count: 15,
    },
};

function buildChatRows() {
    const out = [];
    const askSeen = new Map();
    const pairSeen = new Set();
    for (const [section, spec] of Object.entries(CHAT)) {
        if (spec.aligned) {
            // Ask/reply are written pairwise — the reply only makes sense for
            // its own ask. Random pairing is how the clock answers went out as
            // "what day is it?" → "Just past noon."
            const order = spec.asks.map((_, i) => i).sort((a, b) => hash(spec.asks[a]) - hash(spec.asks[b]));
            for (const i of order.slice(0, Math.min(spec.count, order.length))) {
                out.push({
                    messages: [
                        { role: 'system', content: SYSTEM },
                        { role: 'user', content: `${ANCHOR}\n\n${spec.asks[i]}` },
                        { role: 'assistant', content: spec.replies[i] },
                    ],
                    tools: TOOLS,
                });
            }
            continue;
        }
        let made = 0;
        let guard = 0;
        while (made < spec.count && guard < spec.count * 40) {
            guard++;
            const ask = pick(spec.asks);
            const reply = pick(spec.replies);
            const key = `${ask}\u0000${reply}`;
            if (pairSeen.has(key)) continue;
            if ((askSeen.get(ask) || 0) >= 2) continue; // each ask at most twice
            pairSeen.add(key);
            askSeen.set(ask, (askSeen.get(ask) || 0) + 1);
            out.push({
                messages: [
                    { role: 'system', content: SYSTEM },
                    { role: 'user', content: `${ANCHOR}\n\n${ask}` },
                    { role: 'assistant', content: reply },
                ],
                tools: TOOLS,
            });
            made++;
        }
    }
    return out;
}

const chatRows = buildChatRows();

// ---- 4b. youtube navigation block ----------------------------------------
// The model learns navigation from sequences, not from a description: search
// results → play the URL the user picked; "another one" → the tool's own
// recently-played exclusion returns a different video for the same query;
// "next" when the current one is wrong; "play it again" → Already playing.
// A repeated identical play call is what made the seat replay one video
// (2026-10-18), so every follow-up here changes the call.
const YT = (title, id, extra = '') => `Playing: ${title}${extra}\nhttps://www.youtube.com/watch?v=${id}`;
const YT_ROW = (ask, steps, final) => ({
    messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `${ANCHOR}\n\n${ask}` },
        ...steps.flatMap((s) => [
            { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'youtube', arguments: s.call } }] },
            { role: 'tool', name: 'youtube', content: s.result },
        ]),
        { role: 'assistant', content: final },
    ],
    tools: TOOLS,
});
const youtubeRows = [
    YT_ROW('put on something for focusing', [
        { call: { action: 'play', query: 'deep focus music' }, result: YT('Deep Focus — 3 Hour Study Mix', 'Fv2j8xQm4Rk', ' (1:02:11)') },
    ], 'Deep Focus — 3 Hour Study Mix is on.'),
    YT_ROW('play some fleetwood mac', [
        { call: { action: 'play', query: 'fleetwood mac' }, result: YT('Fleetwood Mac — The Chain (Official Audio)', 'JD9dSpQ3TzA') },
    ], 'The Chain is on.'),
    YT_ROW('search for jazz drumming tutorials', [
        {
            call: { action: 'search', query: 'jazz drumming tutorial', limit: 3 },
            result: [
                '1. Jazz Drumming Basics — Ride Cymbal Patterns — Drum Lab [14:22]\n   https://www.youtube.com/watch?v=Rk2mQ7xJdPw',
                '2. Comping Like a Pro — Jazz Drums — The Practice Room [22:08]\n   https://www.youtube.com/watch?v=Tn8vB4kWqM1',
                '3. Brushes 101 — Swing Feel — After Hours Drums [18:40]\n   https://www.youtube.com/watch?v=Zp5cL9nHrX2',
            ].join('\n'),
        },
    ], 'Three: ride-cymbal basics, a comping lesson, and one on brushes.'),
    YT_ROW('play the second one', [
        { call: { action: 'play', url: 'https://www.youtube.com/watch?v=Tn8vB4kWqM1' }, result: YT('Comping Like a Pro — Jazz Drums — The Practice Room', 'Tn8vB4kWqM1') },
    ], 'Comping Like a Pro is on.'),
    {
        messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: `${ANCHOR}\n\nplay something by mitski` },
            { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'youtube', arguments: { action: 'play', query: 'mitski' } } }] },
            { role: 'tool', name: 'youtube', content: YT('Mitski — Nobody (Official Video)', 'x5Q7mKp2LwN') },
            { role: 'assistant', content: 'Nobody is on.' },
            // Same query, different pick: the tool excludes what it already
            // played, so "another one" lands on a new video without the model
            // inventing a different query or replaying the same one.
            { role: 'user', content: 'another one by her' },
            { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'youtube', arguments: { action: 'play', query: 'mitski' } } }] },
            { role: 'tool', name: 'youtube', content: YT('Mitski — Your Best American Girl', 'p4Js7nQw2Xf') },
            { role: 'assistant', content: 'Your Best American Girl is on.' },
        ],
        tools: TOOLS,
    },
    YT_ROW("this one's not doing it, next", [
        { call: { action: 'next' }, result: YT('How the Transcontinental Railroad Was Built', 'Hq3nV8mTk2R', ' (0:41)') },
    ], 'Moved on to the transcontinental railroad one.'),
    YT_ROW("what's playing?", [
        {
            call: { action: 'now_playing' },
            result: 'Playing: Ambient Works — Late Night Coding Mix (1:12 / 2:48:30)\nhttps://www.youtube.com/watch?v=Qm7vR2xTkP9&t=72s\nThis is the answer to the ask — reply with it now.',
        },
    ], 'Ambient Works — Late Night Coding Mix, about a minute in.'),
    YT_ROW('pause it', [
        {
            call: { action: 'pause' },
            result: 'Paused: Ambient Works — Late Night Coding Mix (1:31 / 2:48:30)',
        },
    ], 'Paused at 1:31.'),
    YT_ROW('play that history documentary about the silk road', [
        { call: { action: 'play', query: 'silk road history documentary' }, result: 'No YouTube results for "silk road history documentary".' },
    ], 'Nothing came up for that. If you know the channel or a more exact title, I can try again.'),
    YT_ROW('play it again', [
        {
            call: { action: 'play', url: 'https://www.youtube.com/watch?v=Fv2j8xQm4Rk' },
            result: 'Already playing: Deep Focus — 3 Hour Study Mix (12:40)\nhttps://www.youtube.com/watch?v=Fv2j8xQm4Rk&t=760s',
        },
    ], 'Still playing — Deep Focus, at 12:40.'),
    YT_ROW('skip ahead two minutes', [
        { call: { action: 'seek', seconds: 120 }, result: 'Seeked to 14:40 — Deep Focus — 3 Hour Study Mix' },
    ], 'At 14:40.'),
];

// ---- 5. assemble + validate ----------------------------------------------
const out = [...proseRows, ...chatRows, ...youtubeRows, ...keptTool];
// No structurally identical conversations.
const seen = new Set();
const finalRows = [];
let dropped = 0;
for (const r of out) {
    const key = JSON.stringify(r.messages);
    if (seen.has(key)) { dropped++; continue; }
    seen.add(key);
    finalRows.push(r);
}
// Every row must carry the tools array and a system prompt, and every tool
// call must still have its result(s) in order (sampling only drops whole rows).
for (const [i, r] of finalRows.entries()) {
    if (r.messages[0]?.role !== 'system') throw new Error(`row ${i}: missing system message`);
    if (!Array.isArray(r.tools) || r.tools.length === 0) throw new Error(`row ${i}: missing tools`);
    let pending = 0;
    for (const m of r.messages) {
        if (m.role === 'assistant' && m.tool_calls?.length) pending += m.tool_calls.length;
        if (m.role === 'tool') pending = Math.max(0, pending - 1);
    }
    if (pending !== 0) throw new Error(`row ${i}: ${pending} unanswered tool call(s)`);
    if (JSON.stringify(r.messages).includes('captain')) throw new Error(`row ${i}: captain survived the scrub`);
}

writeFileSync(OUT, finalRows.map((r) => JSON.stringify(r)).join('\n') + '\n');

// ---- report --------------------------------------------------------------
const callChars = finalRows.reduce((n, r) => n + r.messages.reduce((k, m) =>
    k + (m.tool_calls || []).reduce((j, tc) => j + JSON.stringify(tc.function).length, 0), 0), 0);
const proseChars = finalRows.reduce((n, r) => n + r.messages.reduce((k, m) =>
    k + (m.role === 'assistant' && !m.tool_calls ? (m.content || '').length : 0), 0), 0);
const finalTool = finalRows.filter(hasCalls).length;
console.log(`wrote ${finalRows.length} rows to ${OUT.pathname}`);
console.log(`  prose rows: ${finalRows.length - finalTool} (${((finalRows.length - finalTool) / finalRows.length * 100).toFixed(0)}%)`);
console.log(`  tool rows:  ${finalTool} (${(finalTool / finalRows.length * 100).toFixed(0)}%)`);
console.log(`  assistant prose ${proseChars.toLocaleString()} chars / tool-call JSON ${callChars.toLocaleString()} chars (call share ${(callChars / (proseChars + callChars) * 100).toFixed(0)}%)`);
console.log(`  dropped exact duplicates: ${dropped}`);
console.log('  tool rows kept: ' + report.join(' '));
