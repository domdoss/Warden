// Mercury SFT rows — the memory half of the toolcall fine-tune.
//
// Mercury shares toolcall-ft with iris (one model, one LoRA). Iris rows teach
// tool calls; these rows teach the OTHER thing that model is asked to do in
// production: rolling conversation memory. Before this section existed the
// dataset was 100% iris tool-calling, and mercury was asking the same 3B for
// free-form prose — badly off distribution (the host even carried a defensive
// JSON.parse() unwrap because it kept emitting JSON anyway). So the task was
// reshaped to what Granite is actually good at and already trained on:
// STRUCTURED IN, STRUCTURED OUT.
//
// Contract (authored in /opt/Warden/src/index.ts and EXTRACTED below, exactly
// as the iris rows extract their system prompt from the agent-runner — so the
// fine-tune can never drift from what production sends):
//   user:      STATE:\n<json>\n\nTURNS:\n<role: text lines>
//   assistant: {"facts":[],"decisions":[],"open":[],"refs":[]}
//
// What the rows have to teach, because these are the behaviours that make a
// rolling summary either work or quietly rot:
//   carry     — STATE items survive a compaction they aren't mentioned in.
//   supersede — a changed value REPLACES its old item; it does not sit
//               alongside it (two contradictory items is how a summary starts
//               lying).
//   resolve   — an answered `open` leaves `open` and lands in facts/decisions.
//   dedupe    — the same thing stated twice merges to one item.
//   compress  — oldest material keeps its conclusion and sheds its detail.
//   standalone— every item reads correctly alone; no "he", "it", "that file"
//               pointing at a turn the reader can't see.
//   restraint — chatter that establishes nothing returns STATE unchanged.
//   route     — facts vs decisions vs open vs refs, each to the right field.
//   coldstart — after a context clear STATE arrives all-empty even though the
//               turns are mid-thread: build fresh items from the turns alone,
//               never invent carried ones.
//   results   — Jarvis lines that are delegate RESULT reports ("saved to
//               ~/…, 6 pages, opens clean", "reminder set, task 7f31a2c8")
//               fold like any other turn.
//   senders   — any `Role:` prefix is a turn ('🛡 Sentry:' scan reports,
//               fired reminders, calendar alerts), not just the two names.
//   multihop  — one thread compacts repeatedly; each call merges the previous
//               call's own output, shedding detail as it ages.
//
// Turn text is written in the real voice of this install (Dominic ↔ Jarvis:
// task dispatch, client sites, scheduling, errands, preferences) so train ≈ infer.

import { readFileSync } from 'node:fs';

// Extract the live contract. Throws loudly rather than training a stale prompt.
const HOST_SRC = '/opt/Warden/src/index.ts';
const hostSrc = readFileSync(HOST_SRC, 'utf8');
const mercuryMatch = hostSrc.match(
  /\/\/ MERCURY_SYSTEM_PROMPT_START\s*\nconst MERCURY_SYSTEM_PROMPT = `([\s\S]*?)`;\s*\n\/\/ MERCURY_SYSTEM_PROMPT_END/,
);
if (!mercuryMatch) {
  throw new Error(
    `MERCURY_SYSTEM_PROMPT not found in ${HOST_SRC} — extraction drifted. ` +
    `Keep the // MERCURY_SYSTEM_PROMPT_START / _END marker comments around the const.`,
  );
}
export const MERCURY_SYSTEM = mercuryMatch[1];

const EMPTY = { facts: [], decisions: [], open: [], refs: [] };
const state = (o = {}) => ({ ...EMPTY, ...o });

/** One training row. `turns` is an array of "Role: text" lines. */
function row(inState, turns, outState) {
  return {
    messages: [
      { role: 'system', content: MERCURY_SYSTEM },
      {
        role: 'user',
        content: `STATE:\n${JSON.stringify(state(inState))}\n\nTURNS:\n${turns.join('\n')}`,
      },
      { role: 'assistant', content: JSON.stringify(state(outState)) },
    ],
  };
}

const rows = [];

// ─── First compaction: empty STATE, everything is new ────────────────────
rows.push(row({}, [
  'Dominic: add a calendar event friday at 6pm called poker night',
  'Jarvis: set — poker night, Friday 18:00',
  'Dominic: invite marco sunny and ray',
  'Jarvis: invites out to Marco, Sunny and Ray',
], {
  facts: [
    'Poker night is scheduled for Friday at 18:00.',
    'Marco, Sunny and Ray are invited to poker night.',
  ],
  decisions: [],
  open: [],
  refs: [],
}));

rows.push(row({}, [
  'Dominic: the contact form on the aion site is dumping mail into the void',
  'Jarvis: it posts fine but the host flags direct form mail as spam, so it never reaches the inbox',
  'Dominic: fix the sending not the inbox',
  'Jarvis: the form now sends through the provider relay, landed and confirmed with a test mail',
], {
  facts: [
    'The AiOn site contact form was silently dropped because the host flagged direct form mail as spam.',
    'The form was switched to the provider relay and confirmed with a test message.',
  ],
  decisions: ['Form mail goes through the provider relay rather than a direct host send.'],
  open: [],
  refs: [],
}));

// ─── Carry forward: STATE survives turns that never mention it ───────────
rows.push(row({
  facts: ['Poker night is scheduled for Friday at 18:00 at Dominic\'s place.'],
  decisions: ['The AiOn Systems site deploys to Netlify, not Vercel.'],
  open: ['Whether to invite Ray\'s brother to poker night.'],
  refs: ['~/Warden/data/work/aionsystems-v2/'],
}, [
  'Dominic: what is the weather doing tomorrow',
  'Jarvis: rain most of the afternoon, clearing by evening',
], {
  facts: ['Poker night is scheduled for Friday at 18:00 at Dominic\'s place.'],
  decisions: ['The AiOn Systems site deploys to Netlify, not Vercel.'],
  open: ['Whether to invite Ray\'s brother to poker night.'],
  refs: ['~/Warden/data/work/aionsystems-v2/'],
}));

// ─── Restraint: pure chatter establishes nothing ─────────────────────────
rows.push(row({
  facts: ['The babensushi clone is a practice build and is not meant to go live.'],
  refs: [],
}, [
  'Dominic: morning',
  'Jarvis: morning — anything you want to pick up first?',
  'Dominic: not yet, still waking up',
], {
  facts: ['The babensushi clone is a practice build and is not meant to go live.'],
  decisions: [],
  open: [],
  refs: [],
}));

// ─── Supersede: a changed value replaces, never duplicates ───────────────
rows.push(row({
  facts: ['Poker night is scheduled for Friday at 18:00.'],
  refs: [],
}, [
  'Dominic: move poker night to saturday 7, ray cant do friday anymore',
  'Jarvis: poker night is Saturday 19:00 now',
], {
  facts: ['Poker night is scheduled for Saturday at 19:00, moved from Friday 18:00 because Ray cannot do Fridays.'],
  decisions: [],
  open: [],
  refs: [],
}));

rows.push(row({
  facts: ['The physio appointment is on Wednesdays at 14:00.'],
  decisions: ['Poker night is hosted at Dominic\'s place.'],
}, [
  'Dominic: move the physio to thursdays at 3, wednesdays clash with calls',
  'Jarvis: physio is Thursday 15:00 now',
], {
  facts: ['The physio appointment is on Thursdays at 15:00, moved from Wednesday 14:00 because it clashed with calls.'],
  decisions: ['Poker night is hosted at Dominic\'s place.'],
  open: [],
  refs: [],
}));

// ─── Resolve: an answered open item leaves `open` ────────────────────────
rows.push(row({
  facts: [],
  open: ['Why the babensushi clone loads so slowly.'],
  refs: [],
}, [
  'Jarvis: found it — the hero images were 4MB each straight from the original site, the page pulled 20MB before first paint',
  'Dominic: so squash them',
  'Jarvis: compressed to webp, the page loads in under two seconds now',
], {
  facts: ['The babensushi clone was slow because its hero images were 4MB each; compressed to webp, it now loads in under two seconds.'],
  decisions: ['Images are compressed before they go into a site build.'],
  open: [],
  refs: [],
}));

rows.push(row({
  open: [
    'Whether to keep the Friday 14:00 dentist slot.',
    'Whether the poker snacks are ordered or brought.',
  ],
}, [
  'Dominic: the 14:00 slot is gone, i am taking the tuesday 10:00 one',
  'Jarvis: dentist moved to Tuesday 10:00, the snack question stays open',
], {
  facts: ['The dentist appointment is Tuesday at 10:00; the Friday 14:00 slot was given up.'],
  decisions: ['Morning slots are preferred for medical appointments because afternoons clash with calls.'],
  open: ['Whether the poker snacks are ordered or brought.'],
  refs: [],
}));

// ─── Dedupe: the same thing said twice becomes one item ──────────────────
rows.push(row({
  facts: ['Poker night is hosted at Dominic\'s place.'],
}, [
  'Dominic: remember poker night is at my place',
  'Jarvis: noted — poker night is at your place',
], {
  facts: ['Poker night is hosted at Dominic\'s place.'],
  decisions: [],
  open: [],
  refs: [],
}));

// ─── Compress: oldest keeps its conclusion, sheds its detail ─────────────
rows.push(row({
  facts: [
    'On Tuesday the aion site was down and Netlify showed a build error on the last deploy.',
    'The build error was traced to a missing image referenced by the hero section.',
    'The hero image was re-exported from the design file and the site redeployed successfully.',
  ],
}, [
  'Dominic: the sushi clone wants the same contact form the aion site has',
  'Jarvis: the clone gets the same relay-backed contact form',
], {
  facts: [
    'The aion site outage was a failed Netlify build from a missing hero image; it was re-exported and redeployed.',
    'The babensushi clone gets the same relay-backed contact form as the aion site.',
  ],
  decisions: [],
  open: [],
  refs: [],
}));

// ─── Standalone items: no pronouns pointing outside the item ─────────────
rows.push(row({}, [
  'Dominic: its doing it again',
  'Jarvis: the aion contact form stopped delivering again — the relay rejected the latest test mail',
  'Dominic: get it working and leave a note this time',
  'Jarvis: re-authed the relay, delivery confirmed',
], {
  facts: ['The AiOn contact form stopped delivering again and was fixed by re-authenticating the relay.'],
  decisions: ['Form fixes leave a note in the chat about what was done.'],
  open: [],
  refs: [],
}));

// ─── Routing: each item into the right field ─────────────────────────────
rows.push(row({}, [
  'Dominic: the aion systems site needs to go up before friday',
  'Jarvis: the build is at ~/Warden/data/work/aionsystems-v2/index.html, 7.4KB, notebook style',
  'Dominic: use netlify not vercel, I already have the account',
  'Jarvis: understood — who owns the DNS?',
  'Dominic: no idea, need to check with the registrar',
], {
  facts: ['The AiOn Systems site build is a notebook-style index.html of about 7.4KB.'],
  decisions: ['The AiOn Systems site deploys to Netlify rather than Vercel, because the account already exists.'],
  open: [
    'Who controls the DNS for the AiOn Systems domain, which needs checking with the registrar.',
    'The AiOn Systems site needs to be live before Friday.',
  ],
  refs: ['~/Warden/data/work/aionsystems-v2/index.html'],
}));

// ─── Decisions carry their reason when the turns give one ────────────────
rows.push(row({}, [
  'Dominic: stop testing the contact form against the fake inbox',
  'Jarvis: any particular reason to prefer the real one?',
  'Dominic: we got burned last quarter, mocked tests passed and the prod migration still broke',
], {
  facts: ['A prod migration broke last quarter while mocked tests passed.'],
  decisions: ['Integration tests run against a real database rather than mocks, because mock and prod diverged and hid a broken migration.'],
  open: [],
  refs: [],
}));

// ─── Refs: paths, URLs and ids are kept verbatim ─────────────────────────
rows.push(row({
  refs: ['https://aionsystems.ca'],
}, [
  'Jarvis: the five reddit drafts are in ~/Warden/data/work/reddit-posts-aionsystems/ and the poker table order is #8472',
  'Dominic: keep the order number, i need it for pickup',
], {
  facts: ['Five reddit post drafts are staged for AiOn Systems.', 'The poker table order number is 8472 and is needed for pickup.'],
  decisions: [],
  open: [],
  refs: [
    'https://aionsystems.ca',
    '~/Warden/data/work/reddit-posts-aionsystems/',
    'order #8472',
  ],
}));

// ─── Open item added, then a later compaction resolves it ────────────────
rows.push(row({}, [
  'Dominic: should the aion site use the same font as the logo or something cleaner',
  'Jarvis: the logo font is a licensed display face, not sure yet whether the licence covers web use',
], {
  facts: ['The AiOn logo font is a licensed display face.'],
  decisions: [],
  open: ['Whether the AiOn logo font licence covers web use on the site.'],
  refs: [],
}));

rows.push(row({
  facts: ['The AiOn logo font is a licensed display face.'],
  open: ['Whether the AiOn logo font licence covers web use on the site.'],
}, [
  'Dominic: do not risk the licence, body text uses the free lookalike and the logo font stays inside the logo image',
  'Jarvis: body text moved to the free equivalent, logo untouched',
], {
  facts: [
    'The AiOn logo font is a licensed display face.',
    'The AiOn site body text uses a free equivalent of the logo font, and the logo font appears only inside the logo image.',
  ],
  decisions: ['Licensed fonts stay inside logo images rather than embedded as web fonts, to stay clear of licence questions.'],
  open: [],
  refs: [],
}));

// ─── Contradiction inside one batch of turns: latest wins ────────────────
rows.push(row({}, [
  'Dominic: put the reminder at 9am',
  'Dominic: actually make it 8:30',
  'Jarvis: set for 8:30',
], {
  facts: ['The reminder is set for 8:30am.'],
  decisions: [],
  open: [],
  refs: [],
}));

// ─── A turn that only asks a question leaves an open item ────────────────
rows.push(row({
  facts: ['The physio exercises are meant to be done daily.'],
}, [
  'Dominic: can i double up the physio on weekends instead?',
], {
  facts: ['The physio exercises are meant to be done daily.'],
  decisions: [],
  open: ['Whether the physio exercises can be doubled up on weekends instead of done daily.'],
  refs: [],
}));

// ─── Programmatic variation: carry + one new fact, across domains ────────
// Same mechanic, varied surface — the model should learn that the shape of
// the merge does not change with the topic.
const carryCases = [
  {
    keep: 'Poker night is on Saturday at 19:00 with Marco, Sunny and Ray.',
    turns: ['Dominic: sunny is vegetarian, keep it in mind for snacks', 'Jarvis: noted — vegetarian option at poker night'],
    add: 'Sunny is vegetarian, and poker night snacks include a vegetarian option.',
    field: 'facts',
  },
  {
    keep: 'The babensushi clone lives in ~/Warden/data/work/babensushi-clone/.',
    turns: ['Dominic: is the clone hosted anywhere yet', 'Jarvis: no, it is local only for now'],
    add: 'The babensushi clone is local only and is not hosted anywhere yet.',
    field: 'facts',
  },
  {
    keep: 'AiOn Systems offers one-on-one local AI tutoring, and its site is aionsystems.ca.',
    turns: ['Dominic: never post about aion without saying it is my company', 'Jarvis: understood, disclosure always'],
    add: 'AiOn posts always carry an ownership disclosure, because AiOn is Dominic\'s company.',
    field: 'decisions',
  },
  {
    keep: 'The dentist appointment is on Tuesday at 10:00.',
    turns: ['Dominic: text me a reminder an hour before the dentist', 'Jarvis: reminder set for 09:00'],
    add: 'A reminder text goes out an hour before the dentist appointment.',
    field: 'decisions',
  },
  {
    keep: 'The grocery order goes in on Sunday evening.',
    turns: ['Dominic: add oat milk to the standing order', 'Jarvis: oat milk added, arrives with the next order'],
    add: 'Oat milk is on the standing grocery order.',
    field: 'facts',
  },
];
for (const c of carryCases) {
  const base = { facts: [c.keep] };
  const out = { facts: [c.keep] };
  out[c.field] = c.field === 'facts' ? [c.keep, c.add] : [c.add];
  rows.push(row(base, c.turns, out));
}

// ─── Programmatic variation: supersede across domains ────────────────────
const supersedeCases = [
  {
    before: 'The dinner reservation is Friday at 19:00.',
    turns: ['Dominic: push the reservation to 20:00, the game will run over', 'Jarvis: table moved to 20:00'],
    after: 'The dinner reservation is Friday at 20:00, pushed from 19:00 because the game will run over.',
  },
  {
    before: 'The physio appointment is on Thursdays at 15:00.',
    turns: ['Dominic: physio is fridays at 9 now, thursdays clash with calls', 'Jarvis: physio moved to Friday 09:00'],
    after: 'The physio appointment is on Fridays at 09:00, moved from Thursday 15:00 because Thursdays clash with calls.',
  },
  {
    before: 'The grocery order is delivered on Sunday evenings.',
    turns: ['Dominic: move delivery to saturday morning, too much arrives gone off', 'Jarvis: delivery window is Saturday morning now'],
    after: 'The grocery order is delivered Saturday mornings, moved from Sunday evenings because produce arrived gone off.',
  },
  {
    before: 'The AiOn site header uses the dark navy background.',
    turns: ['Dominic: the header is too heavy, make it white like the rest of the page', 'Jarvis: header switched to white'],
    after: 'The AiOn site header uses a white background, switched from dark navy because the navy read too heavy.',
  },
];
for (const c of supersedeCases) {
  rows.push(row({ facts: [c.before] }, c.turns, { facts: [c.after] }));
}

// ─── Programmatic variation: resolve an open item ────────────────────────
const resolveCases = [
  {
    open: 'Why the reddit posts kept showing as raw markdown.',
    turns: [
      'Jarvis: reddit renders the body literally, the markdown headings were showing as raw asterisks in the post',
      'Dominic: so post plain text',
    ],
    fact: 'Reddit renders post bodies literally, so posts go up as plain text rather than markdown.',
  },
  {
    open: 'Whether Marco is free for poker this Saturday.',
    turns: ['Dominic: marco is back thursday night, he is in for saturday'],
    fact: 'Marco is back Thursday night and is in for poker on Saturday.',
  },
  {
    open: 'What time the poker table rental place is open until.',
    turns: ['Jarvis: the rental place on Main is open until 18:00, pickup has to be before then', 'Dominic: fine, friday after work'],
    fact: 'The poker table rental place on Main closes at 18:00, so pickup was set for Friday after work.',
  },
];
for (const c of resolveCases) {
  rows.push(row({ open: [c.open] }, c.turns, { facts: [c.fact], open: [] }));
}

// ─── Cap pressure: a full STATE plus new material still comes back tidy ──
rows.push(row({
  facts: Array.from({ length: 12 }, (_, i) => `Established fact number ${i + 1} about the household calendar.`),
  decisions: Array.from({ length: 6 }, (_, i) => `Standing decision number ${i + 1} about how errands and hosting are run.`),
  open: ['Whether the tone pass on the reddit drafts happens before posting.'],
  refs: ['https://aionsystems.ca', '~/Warden/data/work/'],
}, [
  'Dominic: the drafts read too much like an ad, rewrite them for people who have never heard of local models',
  'Jarvis: reworking the five drafts, disclosure stays but the pitch goes',
], {
  facts: Array.from({ length: 12 }, (_, i) => `Established fact number ${i + 1} about the household calendar.`),
  decisions: [
    ...Array.from({ length: 6 }, (_, i) => `Standing decision number ${i + 1} about how errands and hosting are run.`),
    'The reddit drafts are written for readers who have never heard of local models, keeping the disclosure and dropping the pitch.',
  ],
  open: ['Whether the tone pass on the reddit drafts happens before posting.'],
  refs: ['https://aionsystems.ca', '~/Warden/data/work/'],
}));

// ─── Empty turns block: nothing to fold, state returns unchanged ─────────
rows.push(row({
  facts: ['The physio appointment is on Fridays at 09:00.'],
  refs: [],
}, [
  'Dominic: ok',
], {
  facts: ['The physio appointment is on Fridays at 09:00.'],
  decisions: [],
  open: [],
  refs: [],
}));

// ─── Reversal: a decision is withdrawn, not left standing beside its undo ─
const reversalCases = [
  {
    before: 'The coffee subscription renews on the 1st of each month.',
    turns: ['Dominic: cancel the coffee subscription, the place on the corner is cheaper', 'Jarvis: subscription cancelled'],
    after: 'The coffee subscription is cancelled in favour of the corner shop, which is cheaper.',
  },
  {
    before: 'Poker night is a monthly event.',
    turns: ['Dominic: make poker weekly, monthly always falls apart', 'Jarvis: poker night is weekly now'],
    after: 'Poker night is weekly rather than monthly, because the monthly cadence kept falling apart.',
  },
  {
    before: 'The weekly grocery delivery covers the full basket.',
    turns: ['Dominic: stop the full basket, half of it went bad, just staples now', 'Jarvis: order trimmed to staples'],
    after: 'The grocery delivery covers staples only, because half the full weekly basket went bad.',
  },
  {
    before: 'The AiOn site contact form runs with no captcha.',
    turns: ['Dominic: the form is getting spam, put a captcha on it after all', 'Jarvis: captcha added'],
    after: 'The AiOn contact form has a captcha after all, added once the form started drawing spam.',
  },
  {
    before: 'The cleaner comes on Friday mornings.',
    turns: ['Dominic: cancel fridays, i am home then and it is in the way', 'Jarvis: cleaning visits cancelled'],
    after: 'The Friday cleaning visits are cancelled because Dominic works from home on Fridays.',
  },
];
for (const c of reversalCases) {
  rows.push(row({ decisions: [c.before] }, c.turns, { decisions: [c.after] }));
}

// ─── Field migration: an open question becomes a decision once settled ───
const migrationCases = [
  {
    open: 'Whether to book the physio weekly or fortnightly.',
    turns: ['Dominic: weekly for now, we will see after a month'],
    decision: 'Physio is booked weekly for now, to be reassessed after a month.',
  },
  {
    open: 'Where to host poker night this month.',
    turns: ['Dominic: mine, ray\'s place is too far out for sunny'],
    decision: 'Poker night is hosted at Dominic\'s place because Ray\'s place is too far out for Sunny.',
  },
  {
    open: 'Whether the sushi clone should use the original restaurant\'s photos.',
    turns: ['Dominic: those photos are the restaurant\'s, use free stock of similar dishes instead'],
    decision: 'The sushi clone uses free stock photos of similar dishes rather than the original restaurant\'s photos.',
  },
  {
    open: 'Whether AiOn client emails should be filed into their own folder.',
    turns: ['Jarvis: filed ones are easy to lose track of', 'Dominic: file them anyway, but invoices stay in the inbox'],
    decision: 'AiOn client emails are filed into their own folder, while invoices stay in the inbox.',
  },
];
for (const c of migrationCases) {
  rows.push(row({ open: [c.open] }, c.turns, { decisions: [c.decision], open: [] }));
}

// ─── Refs hygiene: repeated paths collapse, new ones append ──────────────
const refCases = [
  {
    have: ['~/Warden/data/work/aionsystems-v2/index.html'],
    turns: ['Jarvis: the change is in aionsystems-v2/index.html and the styles file beside it'],
    want: ['~/Warden/data/work/aionsystems-v2/index.html', '~/Warden/data/work/aionsystems-v2/styles.css'],
  },
  {
    have: ['~/Warden/data/work/'],
    turns: ['Dominic: the drafts live under ~/Warden/data/work/ like everything else'],
    want: ['~/Warden/data/work/'],
  },
  {
    have: [],
    turns: ['Jarvis: the receipts are in ~/Documents/receipts-2026/ and the poker table order is #8472'],
    want: ['~/Documents/receipts-2026/', 'order #8472'],
  },
  {
    have: ['grafana.internal/d/api-latency'],
    turns: ['Dominic: oncall watches that grafana board when request handling changes'],
    want: ['grafana.internal/d/api-latency'],
  },
];
for (const c of refCases) {
  const facts = c.have.length === 0
    ? ['Receipt and document locations were recorded for later reference.']
    : [];
  rows.push(row({ refs: c.have }, c.turns, { facts, refs: c.want }));
}

// ─── Long rambling turn compresses to one standalone item ────────────────
rows.push(row({}, [
  'Dominic: so the thing that was driving me mad all afternoon, right, is that the dentist receptionist kept telling me my appointment was moved and i drove over twice for nothing, and it turns out they were looking up the other dominic in their system, and once i gave them my birthday instead of my name it all clicked and the tuesday 10:00 slot was mine the whole time',
], {
  facts: ['The dentist mix-up was a name collision with another Dominic in their system; the Tuesday 10:00 slot was Dominic\'s all along.'],
  decisions: ['Medical appointments are confirmed by date of birth rather than name, because another Dominic is in the same system.'],
  open: [],
  refs: [],
}));

rows.push(row({}, [
  'Dominic: the reason i want the reddit posts spread out over the week instead of all five at once is not really about reach, it is that five posts in one day from a company nobody has heard of reads exactly like spam and people scroll right past it, and if one of them catches on you want the others still coming behind it, not already drowned in the same afternoon',
], {
  facts: ['Posting all five reddit posts in one day would read like spam from an unknown company and drown any post that catches on.'],
  decisions: ['The AiOn reddit posts are spread across the week rather than posted all at once.'],
  open: [],
  refs: [],
}));

// ─── Mixed batch: every field moves at once ──────────────────────────────
rows.push(row({
  facts: ['Poker night is on Saturday at 19:00 at Dominic\'s place.'],
  decisions: ['The AiOn site deploys to Netlify.'],
  open: ['Whether to invite Ray\'s brother to poker night.'],
  refs: ['https://aionsystems.ca'],
}, [
  'Jarvis: the dentist confirmed Tuesday 10:00 and they bill your plan directly',
  'Dominic: yeah invite rays brother, one more is fine, and remind me to text marco about snacks',
  'Jarvis: invite out to Ray\'s brother, snack reminder set for Friday',
  'Dominic: the menu photos for the clone are in ~/Warden/data/work/babensushi-clone/',
], {
  facts: [
    'Poker night is on Saturday at 19:00 at Dominic\'s place.',
    'The dentist appointment is confirmed for Tuesday 10:00 and bills Dominic\'s plan directly.',
    'Ray\'s brother is invited to poker night.',
  ],
  decisions: [
    'The AiOn site deploys to Netlify.',
    'A reminder to text Marco about snacks is set for Friday.',
  ],
  open: [],
  refs: ['https://aionsystems.ca', '~/Warden/data/work/babensushi-clone/'],
}));

// ─── Noise robustness: tool output and status lines in the turns ─────────
rows.push(row({}, [
  'Dominic: run the security scan',
  'Jarvis: ---WARDEN_STATUS---{"phase":"scan","label":"scanning"}',
  'Jarvis: scan finished, nothing listening that should not be, every open port is one you run yourself',
], {
  facts: ['A security scan found nothing unexpected; every open port belongs to a service Dominic runs himself.'],
  decisions: [],
  open: [],
  refs: [],
}));

rows.push(row({}, [
  'Jarvis: [agent-runner] Stream done: doneReason=tool_calls, contentLen=0, toolCalls=1',
  'Jarvis: the job finished and wrote the file',
  'Dominic: good',
], {
  facts: ['A background job completed and wrote its output file.'],
  decisions: [],
  open: [],
  refs: [],
}));

// ─── Domain spread: one new fact per domain, empty state ─────────────────
const freshFacts = [
  {
    turns: ['Dominic: my timezone is vancouver, everything scheduled should assume that'],
    fact: 'The user is in Vancouver and scheduling assumes that timezone.',
  },
  {
    turns: ['Dominic: aion systems is my company, local AI tooling for small businesses'],
    fact: 'The user runs AiOn Systems, which builds local-AI tooling for small businesses.',
  },
  {
    turns: ['Dominic: the desktop is arch with kde plasma on wayland'],
    fact: 'The desktop runs Arch Linux with KDE Plasma on Wayland.',
  },
  {
    turns: ['Dominic: i take my coffee black, no sugar', 'Jarvis: noted'],
    fact: 'Dominic takes his coffee black with no sugar.',
  },
  {
    turns: ['Jarvis: the dentist bills your extended plan directly'],
    fact: 'The dentist bills the extended plan directly.',
  },
  {
    turns: ['Dominic: the physio referral covers six sessions'],
    fact: 'The physio referral covers six sessions.',
  },
  {
    turns: ['Dominic: the aionsystems.ca domain is registered at porkbun until 2028'],
    fact: 'The aionsystems.ca domain is registered at Porkbun until 2028.',
  },
  {
    turns: ['Dominic: the poker crew is marco sunny and ray', 'Jarvis: noted'],
    fact: 'The poker night regulars are Marco, Sunny and Ray.',
  },
  {
    turns: ['Jarvis: the sushi clone now matches the original site dish for dish apart from the photos'],
    fact: 'The babensushi clone matches the original site dish for dish apart from the photos.',
  },
  {
    turns: ['Dominic: anything from aion clients goes to my personal mail until the company inbox exists'],
    fact: 'AiOn client email goes to Dominic\'s personal inbox until a company inbox exists.',
  },
];
for (const c of freshFacts) rows.push(row({}, c.turns, { facts: [c.fact] }));

// ─── Two compactions in sequence over the same thread ────────────────────
// Teaches that the second call sees its own previous output as STATE.
const seqState1 = {
  facts: ['The five reddit drafts are written and staged but not posted.'],
  open: ['Whether the drafts need a tone pass before posting.'],
  refs: ['~/Warden/data/work/reddit-posts-aionsystems/'],
};
rows.push(row({}, [
  'Dominic: write five reddit posts for aion systems, one per subreddit',
  'Jarvis: drafted all five into ~/Warden/data/work/reddit-posts-aionsystems/, not posted yet',
  'Dominic: I want to read them before anything goes up',
], seqState1));
rows.push(row(seqState1, [
  'Dominic: they read like an ad, rewrite for people who have never heard of local models',
  'Jarvis: rewriting, keeping the disclosure and dropping the pitch',
], {
  facts: ['The five reddit drafts are written and staged but not posted.'],
  decisions: ['The reddit drafts are rewritten for readers unfamiliar with local models, keeping the disclosure and removing the sales pitch.'],
  open: [],
  refs: ['~/Warden/data/work/reddit-posts-aionsystems/'],
}));

// ─── Post-clear cold start: STATE arrives all-empty mid-thread ───────────
// The host gates the stored state on the context-clear boundary, so the
// compaction right after a clear sees {"facts":[],...} even though the turns
// are mid-conversation. The model must build fresh items and never invent
// carried ones.
rows.push(row({}, [
  'Dominic: yeah do the same fix for the contact page',
  'Jarvis: done — the contact page uses the relay form now, same as the homepage',
  'Dominic: good, that closes out the aion site work for the week',
], {
  facts: [
    'The AiOn site contact page uses the same relay-backed form as the homepage.',
    'The AiOn site work is finished for the week.',
  ],
  decisions: [],
  open: [],
  refs: [],
}));

rows.push(row({}, [
  'Dominic: same again for tuesday, the early one',
  'Jarvis: physio booked Tuesday 09:00, usual clinic',
  'Dominic: and the usual reminder an hour before',
  'Jarvis: reminder set for 08:00',
], {
  facts: ['The physio appointment is booked for Tuesday at 09:00 at the usual clinic.'],
  decisions: ['A reminder goes out an hour before the physio appointment.'],
  open: [],
  refs: [],
}));

// A clear followed by chatter: nothing established, nothing invented.
rows.push(row({}, [
  'Dominic: clearing the deck, fresh start',
  'Jarvis: understood, nothing carried over',
], { facts: [], decisions: [], open: [], refs: [] }));

// Result-shaped lines are the first thing seen after a clear.
rows.push(row({}, [
  'Jarvis: reminder set, task 7f31a2c8 — text marco about snacks friday',
  'Dominic: perfect',
  'Jarvis: and the grocery order went in, 84.52, three bags, thursday delivery',
  'Dominic: good',
], {
  facts: [
    'A reminder to text Marco about snacks is set for Friday (task 7f31a2c8).',
    'The grocery order went in for 84.52, three bags, delivered Thursday.',
  ],
  decisions: [],
  open: [],
  refs: ['task 7f31a2c8'],
}));

// Turns that reference a pre-clear past may only keep what the turns
// themselves restate — the recap line carries the facts, not the listener.
rows.push(row({}, [
  'Dominic: after the clear — where were we on the clone?',
  'Jarvis: from this thread alone: the menu was swapped, the fonts were still pending',
], {
  facts: ['The babensushi clone menu was swapped before the clear.'],
  decisions: [],
  open: ['The babensushi clone fonts, still pending at the clear.'],
  refs: [],
}));

// A fired reminder landing right after a clear starts the state fresh.
rows.push(row({}, [
  'Jarvis: Reminder: charge the earbuds before the northbeam call',
  'Dominic: on it, charging now',
  'Jarvis: ⏰ Calendar: "northbeam intro call" starts now',
], {
  facts: ['The northbeam intro call started, and the earbuds were put on to charge beforehand.'],
  decisions: [],
  open: [],
  refs: [],
}));

// A recap turn after a clear is a legitimate source of fresh items.
rows.push(row({}, [
  'Dominic: ok that is everything for today',
  'Jarvis: agreed — dentist tuesday, physio friday, poker saturday',
  'Dominic: goodnight',
], {
  facts: [
    'The dentist appointment is on Tuesday.',
    'The physio appointment is on Friday.',
    'Poker night is on Saturday.',
  ],
  decisions: [],
  open: [],
  refs: [],
}));

// Supersede inside the fresh window: the later value wins with no STATE to
// replace, so the item is written once, at its final value.
rows.push(row({}, [
  'Dominic: dinner friday 19:00 at the sushi place on main',
  'Jarvis: booked, table for four, under dos santos',
  'Dominic: make it 20:00, i forgot about the late call',
  'Jarvis: moved to 20:00, same table',
], {
  facts: ['The Friday dinner reservation is for 20:00 at the sushi place on Main, table for four under dos Santos, moved from 19:00.'],
  decisions: [],
  open: [],
  refs: [],
}));

// ─── Realistic compaction windows: long mixed batches with result lines ──
// The real fold batch is the ~33 oldest messages, mixed senders, with many
// Jarvis lines that are delegate RESULT reports rather than conversation.

rows.push(row({}, [
  'Dominic: start the sushi clone tonight',
  'Jarvis: scaffolded at ~/Warden/data/work/babensushi-clone/, homepage and menu pages up',
  'Dominic: menu needs the real dishes not the placeholder ones',
  'Jarvis: menu swapped to the real dish list, 42 items, opens clean',
  'Dominic: photos next',
  'Jarvis: photos are free stock of the same dishes, compressed to webp',
  'Dominic: hours in the footer are wrong, they close mondays',
  'Jarvis: footer hours fixed, closed mondays',
  'Dominic: does it hold up on a phone',
  'Jarvis: checked at 375px — nav collapses, nothing overflows',
  'Dominic: good enough, it is practice anyway',
  'Jarvis: noted — practice build, not going live',
  'Dominic: now add poker night to the calendar, saturday 7pm',
  'Jarvis: poker night set, Saturday 19:00, reminder the morning of',
  'Dominic: marco sunny and ray',
  'Jarvis: invites out to Marco, Sunny and Ray',
  'Dominic: snacks this time, last time we had nothing',
  'Jarvis: snack list started, vegetarian option for Sunny',
], {
  facts: [
    'The babensushi clone at ~/Warden/data/work/babensushi-clone/ has the real 42-item menu, free-stock photos compressed to webp, and correct hours including closed Mondays.',
    'The clone was checked at 375px: the nav collapses and nothing overflows.',
    'Poker night is on the calendar for Saturday at 19:00, with Marco, Sunny and Ray invited.',
    'A snack list with a vegetarian option for Sunny was started for poker night.',
  ],
  decisions: [
    'The clone is a practice build and is not going live.',
    'A reminder goes out on the morning of poker night.',
  ],
  open: ['Finishing the poker night snack list.'],
  refs: ['~/Warden/data/work/babensushi-clone/'],
}));

rows.push(row({}, [
  'Dominic: the aion hero is too busy',
  'Jarvis: simplified the hero, one line of text and the booking button',
  'Dominic: its a lottle overdone i was thinking more like brain neurons',
  'Jarvis: swapped the hero art for a minimal neuron graphic, thin lines on white',
  'Dominic: yeah that',
  'Jarvis: booked — hero stays',
  'Dominic: start the reddit posts for aion, one per subreddit',
  'Jarvis: five drafts staged in ~/Warden/data/work/reddit-posts-aionsystems/, one per subreddit',
  'Dominic: spread them over the week, five in one day reads like spam',
  'Jarvis: schedule set, one per day monday to friday',
  'Dominic: rewrite them for people who have never heard of local models',
  'Jarvis: rewriting, disclosure stays but the pitch goes',
  'Dominic: keep the aionsystems.ca link out of the body, comments only',
  'Jarvis: link moved to comments only',
  'Dominic: what about the contact form spam',
  'Jarvis: captcha added, the spam stopped',
  'Dominic: anything else on the site',
  'Jarvis: the site needs to be live before friday, dns still with the registrar',
  'Dominic: i will call them tomorrow',
  'Jarvis: noted',
], {
  facts: [
    'The AiOn hero uses a minimal neuron graphic, thin lines on white, chosen after Dominic rejected the first version as overdone.',
    'Five reddit drafts for AiOn are staged in ~/Warden/data/work/reddit-posts-aionsystems/, one per subreddit, scheduled one per day Monday to Friday.',
    'The AiOn contact form got a captcha and the spam stopped.',
    'The AiOn site DNS is still with the registrar.',
  ],
  decisions: [
    'The reddit drafts are written for readers who have never heard of local models, keeping the disclosure and dropping the pitch.',
    'The aionsystems.ca link goes in comments only, never in the post body.',
  ],
  open: ['Moving the AiOn site DNS so it can go live before Friday; Dominic is calling the registrar.'],
  refs: ['~/Warden/data/work/reddit-posts-aionsystems/', 'https://aionsystems.ca'],
}));

rows.push(row({}, [
  'Dominic: plan saturday properly',
  'Jarvis: poker night saturday 19:00 at your place, marco sunny and ray confirmed',
  'Dominic: snacks this time, last time we had nothing',
  'Jarvis: snack list started, vegetarian option for sunny',
  'Dominic: and the table, we still do not have one',
  'Jarvis: rental place on main has folding tables, one held for friday pickup',
  'Jarvis: reminder set, task 7f31a2c8 — pick the table up before 18:00 friday',
  'Dominic: good',
  '🛡 Sentry: 🛡 Security scan found something new: python3 -m http.server 8471 bound to 0.0.0.0 serving /home/dominic/Projects/zuck — not on the known-good list',
  'Jarvis: that is the zuck project preview you left running, flagged but left alone',
  'Dominic: yeah thats mine, leave it',
  'Jarvis: noted as known-good',
  'Dominic: dentist this week?',
  'Jarvis: tuesday 10:00, reminder set for 09:00, they bill your plan directly',
  'Dominic: email the sushi place about the clone when it is decent',
  'Jarvis: email drafted, in your outbox for review',
  'Dominic: send it friday after the site is tidied',
  'Jarvis: scheduled — email goes out Friday once the clone is tidied',
  'Dominic: physio?',
  'Jarvis: friday 09:00, six sessions on the referral',
], {
  facts: [
    'Poker night is Saturday at 19:00 at Dominic\'s place, with Marco, Sunny and Ray confirmed and a snack list that includes a vegetarian option for Sunny.',
    'A folding table is held at the rental place on Main for Friday pickup before 18:00 (task 7f31a2c8).',
    'A Sentry scan flagged a python http server on port 8471 serving /home/dominic/Projects/zuck; it is Dominic\'s own project preview and was marked known-good.',
    'The dentist appointment is Tuesday at 10:00 with a 09:00 reminder, billing the plan directly.',
    'The physio appointment is Friday at 09:00, with six sessions on the referral.',
    'An email to the sushi place about the clone is drafted and waiting in the outbox.',
  ],
  decisions: ['The email to the sushi place goes out Friday after the clone is tidied.'],
  open: [],
  refs: ['task 7f31a2c8'],
}));

rows.push(row({}, [
  'Dominic: anything in the inbox',
  'Jarvis: three worth your time — the sushi client reply, the zoom invite for gordon, and a failed $31.49 uber eats refund',
  'Dominic: chase the refund first',
  'Jarvis: dispute filed with uber eats, order 9f2b from sunday, refund should land in 3 to 5 days',
  'Dominic: the sushi client?',
  'Jarvis: they want the clone link this week, i said friday once it is tidied',
  'Dominic: fine',
  'Jarvis: the zoom invite is gordon\'s intro to AI, tuesday 14:30',
  'Dominic: add it to the calendar',
  'Jarvis: on the calendar, reminder 10 minutes before',
  'Dominic: anything else',
  'Jarvis: two linkedin connection requests and a newsletter, nothing needed',
  'Dominic: archive the newsletter',
  'Jarvis: archived',
  'Dominic: invoices?',
  'Jarvis: one from porkbun, the aionsystems.ca renewal, due next month',
  'Dominic: pay it when it lands',
], {
  facts: [
    'An Uber Eats dispute was filed for a failed $31.49 Sunday order (order 9f2b), with the refund due in 3 to 5 days.',
    'The sushi client wants the clone link this week and was told Friday.',
    'Gordon\'s intro to AI session is Tuesday at 14:30 on Zoom, on the calendar with a 10-minute reminder.',
    'A Porkbun invoice for the aionsystems.ca renewal is due next month.',
  ],
  decisions: ['The Porkbun invoice is paid when it lands.'],
  open: [],
  refs: ['order 9f2b', 'https://aionsystems.ca'],
}));

rows.push(row({}, [
  'Dominic: the conn site is dead slow on my phone',
  'Jarvis: the hero video is 40MB, that is the whole story',
  'Dominic: kill it',
  'Jarvis: video swapped for a static hero image, page is 800KB now',
  'Dominic: check it at phone width',
  'Jarvis: checked at 375px and 390px — nav collapses, announcement banner fully visible',
  'Dominic: the banner was cut off before',
  'Jarvis: fixed, it was a negative margin on the hero',
  'Dominic: attach the fixed file in the chat',
  'Jarvis: attached — the fixed index.html from ~/Projects/conn',
  'Dominic: now the aion contact page, same treatment',
  'Jarvis: the build is in ~/Warden/data/work/aionsystems-v2/, contact page on the relay form, opens clean',
  'Dominic: 6 pages still?',
  'Jarvis: 6 pages, notebook style, 7.4KB homepage',
  'Dominic: good enough, send it to netlify',
  'Jarvis: deployed to netlify, live on the preview domain until the dns moves',
], {
  facts: [
    'The conn site was slow because of a 40MB hero video, replaced with a static image bringing the page to 800KB.',
    'The conn banner cut-off was a negative margin on the hero, fixed and verified at 375px and 390px.',
    'The fixed conn index.html was attached in the chat from ~/Projects/conn.',
    'The AiOn site build in ~/Warden/data/work/aionsystems-v2/ has 6 pages with a 7.4KB homepage, and its contact page uses the relay form.',
    'The AiOn site is deployed to Netlify and live on the preview domain.',
  ],
  decisions: [],
  open: ['Moving the DNS so the AiOn site goes live on its real domain.'],
  refs: ['~/Projects/conn', '~/Warden/data/work/aionsystems-v2/'],
}));

// ─── Three compactions in sequence over one thread ───────────────────────
// The real cadence: the same thread folds again and again, each call merging
// its own previous output. Small realistic changes per hop.
const hopA1 = {
  facts: ['Poker night is planned for Saturday at 19:00 at Dominic\'s place, with Marco, Sunny and Ray invited.'],
  open: ['What to serve for snacks at poker night.'],
  refs: [],
};
rows.push(row({}, [
  'Dominic: lets do poker saturday 7 at mine',
  'Jarvis: poker night, Saturday 19:00 at your place',
  'Dominic: marco sunny and ray as usual',
  'Jarvis: invites out to all three',
  'Dominic: we need actual food this time',
], hopA1));
const hopA2 = {
  facts: ['Poker night is on Saturday at 19:00 at Dominic\'s place, with Marco, Sunny and Ray invited.'],
  decisions: ['Sunny brings the snacks, with a vegetarian option included.'],
  open: ['Whether Ray can make Saturday after all.'],
  refs: [],
};
rows.push(row(hopA1, [
  'Dominic: ray might be stuck at work, hold his seat',
  'Jarvis: ray\'s seat is held pending confirmation',
  'Dominic: sunny is bringing snacks, make sure there is a vegetarian one',
  'Jarvis: noted — snacks on Sunny, vegetarian option in',
], hopA2));
rows.push(row(hopA2, [
  'Dominic: ray is in, lock it',
  'Jarvis: locked — four for poker saturday, table pickup reminder set for friday',
  'Dominic: good',
], {
  facts: ['Poker night is Saturday at 19:00 at Dominic\'s place, with Marco, Sunny and Ray confirmed and the fourth seat locked.'],
  decisions: ['Sunny brings the snacks, with a vegetarian option included.'],
  open: [],
  refs: [],
}));

const hopB1 = {
  facts: ['The babensushi clone is scaffolded at ~/Warden/data/work/babensushi-clone/.'],
  open: ['Swapping the clone menu to the real dish list.'],
  refs: ['~/Warden/data/work/babensushi-clone/'],
};
rows.push(row({}, [
  'Dominic: start the sushi clone',
  'Jarvis: scaffolded at ~/Warden/data/work/babensushi-clone/, homepage up, menu still placeholder',
  'Dominic: swap in the real dishes',
], hopB1));
const hopB2 = {
  facts: ['The babensushi clone at ~/Warden/data/work/babensushi-clone/ has the real 42-item menu and free-stock photos.'],
  open: ['Swapping the clone fonts to the original site\'s faces.'],
  refs: ['~/Warden/data/work/babensushi-clone/'],
};
rows.push(row(hopB1, [
  'Jarvis: menu swapped to the real dish list, 42 items, opens clean',
  'Dominic: photos next, not the restaurant\'s own',
  'Jarvis: free stock of the same dishes, compressed',
  'Dominic: the fonts are wrong now',
], hopB2));
rows.push(row(hopB2, [
  'Jarvis: fonts swapped, checked at 375px and 390px, nothing overflows',
  'Dominic: that is the clone done for now',
], {
  facts: ['The babensushi clone at ~/Warden/data/work/babensushi-clone/ has the real 42-item menu, free-stock photos, and the original site\'s fonts, verified at 375px and 390px.'],
  decisions: [],
  open: [],
  refs: ['~/Warden/data/work/babensushi-clone/'],
}));

const hopC1 = {
  facts: ['A Friday dinner reservation is booked for 19:00 at the sushi place on Main, table for four.'],
  open: ['Whether Marco and Sunny are free for the Friday dinner.'],
  refs: [],
};
rows.push(row({}, [
  'Dominic: dinner friday 7 at the sushi place, table for four',
  'Jarvis: booked, table for four under dos santos',
  'Dominic: see if marco and sunny are free',
], hopC1));
const hopC2 = {
  facts: ['A Friday dinner reservation is booked for 19:00 at the sushi place on Main, table for four.'],
  decisions: ['Marco and Sunny are confirmed for the Friday dinner.'],
  open: ['Whether to move the dinner to 20:00 because of Dominic\'s late call.'],
  refs: [],
};
rows.push(row(hopC1, [
  'Jarvis: marco and sunny are both in for friday',
  'Dominic: my last call runs late though',
  'Jarvis: the restaurant can move it to 20:00 if needed',
], hopC2));
rows.push(row(hopC2, [
  'Dominic: just move it',
  'Jarvis: moved to 20:00, same table',
], {
  facts: ['The Friday dinner with Marco and Sunny is booked for 20:00 at the sushi place on Main, table for four under dos Santos, moved from 19:00.'],
  decisions: ['Marco and Sunny are confirmed for the Friday dinner.'],
  open: [],
  refs: [],
}));

// ─── Non-Jarvis bot senders: any Role: prefix is a turn ──────────────────
rows.push(row({}, [
  '🛡 Sentry: 🛡 Security scan found something new: outbound tcp to 149.154.166.110:443 — could not identify the process at scan time',
  'Jarvis: that is telegram — the bot polling the api from the dashboard, expected',
  'Dominic: good',
], {
  facts: ['The outbound connection to 149.154.166.110 is the Telegram bot polling and is expected.'],
  decisions: [],
  open: [],
  refs: [],
}));

rows.push(row({}, [
  '🛡 Sentry: 🛡 Security scan found something new: port 8765 listening (python, /home/dominic/alpha-stack/webapp/app.py) — not on the known-good list',
  'Dominic: thats my own app, leave it running',
  'Jarvis: marked known-good',
], {
  facts: ['The python app listening on port 8765 (alpha-stack webapp) is Dominic\'s own and was marked known-good.'],
  decisions: [],
  open: [],
  refs: [],
}));

// A calendar firing line folds like any other turn, keeping the URL as a ref.
rows.push(row({}, [
  'Jarvis: ⏰ Calendar: "Gordon\'s intro to AI - #1" starts now (2026-09-15T14:30:00-07:00) @ https://us06web.zoom.us/j/85138619018',
  'Dominic: on my way',
], {
  facts: ['Gordon\'s intro to AI session #1 started at 14:30 and Dominic joined it.'],
  decisions: [],
  open: [],
  refs: ['https://us06web.zoom.us/j/85138619018'],
}));

// A bot-only turn that establishes nothing: STATE returns unchanged.
rows.push(row({
  facts: ['The poker table rental is held for Friday pickup before 18:00.'],
}, [
  '🛡 Sentry: 🛡 Security scan finished: nothing new since the last run',
], {
  facts: ['The poker table rental is held for Friday pickup before 18:00.'],
  decisions: [],
  open: [],
  refs: [],
}));

// ─── Fired reminders in the turns ────────────────────────────────────────
// The host injects fired reminders as chat messages. A reminder about a thing
// already in STATE must not duplicate it; a fresh one folds to the fact that
// it fired and what it said.

// Reminder restates an existing item: no duplicate, STATE unchanged.
rows.push(row({
  facts: ['The earbuds should be charged before the northbeam call.'],
}, [
  'Jarvis: Reminder: charge the earbuds before the northbeam call',
], {
  facts: ['The earbuds should be charged before the northbeam call.'],
  decisions: [],
  open: [],
  refs: [],
}));

// Fresh reminder: the fact is that it fired, with its content.
rows.push(row({}, [
  'Jarvis: Reminder: pick up the poker table before 18:00 friday',
  'Dominic: right, after work',
], {
  facts: ['A reminder fired to pick up the poker table before 18:00 on Friday, planned for after work.'],
  decisions: [],
  open: [],
  refs: [],
}));

// Reminder fires and the task is done: the pending item is superseded.
rows.push(row({
  facts: ['A reminder is set to charge the earbuds before the northbeam call.'],
}, [
  'Jarvis: Reminder: charge the earbuds before the northbeam call',
  'Dominic: done, they are on the charger now',
], {
  facts: ['The earbuds are on the charger ahead of the northbeam call.'],
  decisions: [],
  open: [],
  refs: [],
}));

// Reminder fires and the user reschedules: the item moves, it does not
// leave a stale copy beside the new one.
rows.push(row({
  facts: ['A reminder is set to text Marco about snacks on Friday.'],
}, [
  'Jarvis: Reminder: text marco about snacks',
  'Dominic: not yet, bump it to saturday morning',
  'Jarvis: reminder moved to Saturday morning',
], {
  facts: ['The reminder to text Marco about snacks is moved to Saturday morning.'],
  decisions: [],
  open: [],
  refs: [],
}));

// ─── Format discipline ───────────────────────────────────────────────────
// A 3B needs the output contract drilled, not just stated. These rows pair
// inputs that TEMPT a different shape (a question aimed at the summarizer,
// a code block, a demand for prose) with the only correct response: the JSON
// object, all four keys present, nothing around it.

// Directly addressed — Mercury summarizes, it does not answer.
rows.push(row({
  facts: ['The AiOn site deploys to Netlify.'],
}, [
  'Dominic: mercury, what do you think we should do about the netlify account?',
  'Jarvis: that one is for me, not the memory layer',
], {
  facts: ['The AiOn site deploys to Netlify.'],
  decisions: [],
  open: ['What to change about the Netlify account.'],
  refs: [],
}));

rows.push(row({}, [
  'Dominic: summarise that in a paragraph for me',
  'Jarvis: the contact form is live, the spam filter is trained, and all three test mails landed',
], {
  facts: ['The AiOn contact form is live with a trained spam filter, and all three test mails landed.'],
  decisions: [],
  open: [],
  refs: [],
}));

// Code blocks in the turns — keep the conclusion, not the listing.
rows.push(row({}, [
  'Jarvis: the fix is `if (window.innerWidth < 640) { collapseMenu() }`',
  'Dominic: right, and it collapses before the hours block renders',
], {
  facts: ['The babensushi clone nav collapses on viewports under 640px, before the hours block renders.'],
  decisions: [],
  open: [],
  refs: [],
}));

// Quotes and apostrophes inside items must survive as valid JSON strings.
rows.push(row({}, [
  'Dominic: the post title is "Small models quietly crossed the good enough line"',
  'Jarvis: noted, that one targets r/AI',
], {
  facts: ['The r/AI post is titled "Small models quietly crossed the good enough line".'],
  decisions: [],
  open: [],
  refs: [],
}));

rows.push(row({}, [
  "Dominic: don't book anything sunday mornings, that's my sleep-in",
], {
  facts: [],
  decisions: ["Sunday mornings stay unbooked; they are reserved for sleeping in."],
  open: [],
  refs: [],
}));

// Exact values — times, ports, sizes, ids — are preserved verbatim.
rows.push(row({}, [
  'Jarvis: the grocery order came to 84.52, three bags, delivery thursday between 2 and 4',
  'Dominic: and the order number?',
  'Jarvis: 8472',
], {
  facts: ['Grocery order 8472 came to 84.52 for three bags, delivered Thursday between 2pm and 4pm.'],
  decisions: [],
  open: [],
  refs: [],
}));

rows.push(row({}, [
  'Jarvis: the dentist is suite 302 at 4th and maple, tuesday 10:00, bring the care card',
], {
  facts: ['The dentist is in suite 302 at 4th and Maple, Tuesday at 10:00, and the care card is needed.'],
  decisions: [],
  open: [],
  refs: [],
}));

// Every key present even when three of them are empty.
rows.push(row({}, [
  'Dominic: remember I prefer 2.4GHz on this machine',
], {
  facts: ['The user prefers the 2.4GHz wifi band on this machine.'],
  decisions: [],
  open: [],
  refs: [],
}));

// Empty STATE and turns that establish nothing: all four keys, all empty.
rows.push(row({}, [
  'Dominic: haha',
  'Jarvis: :)',
], { facts: [], decisions: [], open: [], refs: [] }));

// Unicode and names survive unmangled.
rows.push(row({}, [
  'Dominic: the café booking is under Désirée, table for four',
], {
  facts: ['A café booking for four is held under the name Désirée.'],
  decisions: [],
  open: [],
  refs: [],
}));

// A path with a tilde and a query string stays intact in refs.
rows.push(row({}, [
  'Jarvis: the clone loads its menu from menu-items.json?section=sushi',
  'Dominic: and the drafts are in ~/Warden/data/work/reddit-posts-aionsystems/',
], {
  facts: [],
  decisions: [],
  open: [],
  refs: ['menu-items.json?section=sushi', '~/Warden/data/work/reddit-posts-aionsystems/'],
}));

// ─── Nitty-gritty merge edges ────────────────────────────────────────────

// Partial supersede: one attribute changes, the rest of the item survives.
rows.push(row({
  facts: ['The physio appointment is on Fridays at 09:00 at the Keefer clinic.'],
}, [
  'Dominic: move the physio to 16:30, mornings are gone',
], {
  facts: ['The physio appointment is on Fridays at 16:30 at the Keefer clinic.'],
  decisions: [],
  open: [],
  refs: [],
}));

// Two STATE items merge into one when a turn reveals they are the same thing.
rows.push(row({
  facts: [
    'A dinner booking for Saturday was made but the details were unclear.',
    'Marco and Sunny asked about getting together Saturday evening.',
  ],
}, [
  'Jarvis: it is one thing — the Saturday dinner with Marco and Sunny, 19:00 at the sushi place on Main',
], {
  facts: ['The Saturday dinner with Marco and Sunny is booked for 19:00 at the sushi place on Main.'],
  decisions: [],
  open: [],
  refs: [],
}));

// A fact is falsified outright and must be removed, not softened.
rows.push(row({
  facts: ['Poker night this week is at Ray\'s place.'],
}, [
  'Dominic: ray\'s fell through, it is back at mine',
], {
  facts: ['Poker night this week is at Dominic\'s place; the plan to host it at Ray\'s fell through.'],
  decisions: [],
  open: [],
  refs: [],
}));

// An open item that the turns make MORE specific rather than resolving.
rows.push(row({
  open: ['Something is wrong with the reddit posting flow.'],
}, [
  'Jarvis: it gets as far as the submit form and then posts the body as raw markdown instead of rendering it',
], {
  facts: [],
  decisions: [],
  open: ['The reddit posting flow reaches the submit form but posts the body as raw markdown instead of rendering it.'],
  refs: [],
}));

// Conflicting statements across turns: the later one wins, no contradiction kept.
rows.push(row({}, [
  'Jarvis: the reservation is for 19:00',
  'Dominic: no, 20:00',
  'Jarvis: corrected, table held for 20:00',
], {
  facts: ['The table is reserved for 20:00.'],
  decisions: [],
  open: [],
  refs: [],
}));

// Speculation is not recorded as fact.
rows.push(row({}, [
  'Jarvis: the slow site load might be the images, or possibly the host throttling, I have not confirmed which',
  'Dominic: find out before you change anything',
], {
  facts: [],
  decisions: ['The cause is confirmed before any change is made.'],
  open: ['Whether the images or the host cause the slow site load, which is unconfirmed.'],
  refs: [],
}));

// A decision plus the constraint that drove it, kept together in one item.
rows.push(row({}, [
  'Dominic: keep the aion posts off linkedin for now, reddit only',
  'Jarvis: because the punchy reddit tone reads wrong next to the linkedin audience',
  'Dominic: exactly',
], {
  facts: [],
  decisions: ['The AiOn posts go to Reddit only for now, because the reddit tone reads wrong for the LinkedIn audience.'],
  open: [],
  refs: [],
}));

export const examples = rows;

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`mercury rows: ${rows.length}`);
  console.log(`system prompt: ${MERCURY_SYSTEM.length} chars (extracted from ${HOST_SRC})`);
}