// ─── Warden BBS telnet daemon ────────────────────────────────────────────────
// Serves the BBS as ANSI over a raw TCP line — the console surface. The same
// boards/files/mail/bulletins/online data the browser shows, reachable from any
// `telnet`/`nc` client. Line-based (type a number, press Enter) so it needs no
// PTY or raw-mode handling; arrow-key lightbars can layer on later.
import net from 'net';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import ssh2 from 'ssh2';
import { logger } from './logger.js';
import { listBbsBoards, listBbsThreads, listBbsPosts, listFriendMessages, listBbsMentions, countBbsUnreadMentions, getBbsCallerPassword } from './db.js';
import { myHostname, bbsFiles, bbsBulletins, listFriends, getSelfProfile, bbsCheckPassword, bbsRegisterUser, bbsFileReadBase64, bbsFileUpload, bbsGetProfile, bbsSetProfile } from './friends.js';
import { zmodemSend, zmodemReceive } from './zmodem.js';

const PORT = parseInt(process.env.BBS_TELNET_PORT || '2323', 10);
// Remote dial-in is the point of a BBS, so we bind all interfaces by default.
// The node is a Tailscale host, so the tailnet encrypts telnet's transport;
// on an untrusted LAN prefer SSH (cleartext telnet password). Lock back to
// loopback with BBS_TELNET_HOST=127.0.0.1 if you only want the local console.
const HOST = process.env.BBS_TELNET_HOST || '0.0.0.0';
const W = 78;

const A = {
  reset: '\x1b[0m', dim: '\x1b[2m', inv: '\x1b[7m',
  red: '\x1b[31m', green: '\x1b[32m', amber: '\x1b[33m', blue: '\x1b[34m',
  magenta: '\x1b[35m', cyan: '\x1b[36m', white: '\x1b[37m',
  bRed: '\x1b[91m', bGreen: '\x1b[92m', bAmber: '\x1b[93m', bBlue: '\x1b[94m',
  bMagenta: '\x1b[95m', bCyan: '\x1b[96m', bWhite: '\x1b[97m', gray: '\x1b[90m',
};
const CLS = '\x1b[2J\x1b[H';

function c(color: keyof typeof A, s: string): string { return A[color] + s + A.reset; }
function visLen(s: string): number { return s.replace(/\x1b\[[0-9;]*m/g, '').length; }
function hr(n: number): string { return '─'.repeat(n); }
function center(s: string, w: number): string {
  const l = visLen(s);
  return ' '.repeat(Math.max(0, Math.floor((w - l) / 2))) + s;
}
function pad(s: string, w: number): string { return s + ' '.repeat(Math.max(0, w - visLen(s))); }
function frameTitle(t: string, w: number): string {
  const label = c('bAmber', ' ' + t + ' ');
  const l = Math.floor((w - visLen(label)) / 2);
  return '╔' + hr(w) + '╗\n║' + ' '.repeat(Math.max(0, l)) + label + ' '.repeat(Math.max(0, w - l - visLen(label))) + '║\n╠' + hr(w) + '╣';
}
function frameLine(left: string, right: string, w: number): string {
  const gap = w - visLen(left) - visLen(right);
  return '║' + left + ' '.repeat(Math.max(1, gap)) + right + '║';
}
function frameFoot(w: number): string { return '╚' + hr(w) + '╝'; }
function sel(i: number, s: Session, str: string): string { return i === s.bar ? A.inv + str + A.reset : str; }
function itemCount(s: Session): number {
  if (s.screen === 'menu') return visibleMenu(s.level).length;
  if (s.screen === 'boards') return listBbsBoards().length;
  return 0;
}

function shortHost(h: string): string { return String(h || '').split('.')[0] || h || '?'; }
function fmtWhen(iso: string): string {
  try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; }
}
function fmtSize(n: number): string { n = Number(n) || 0; return n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB'; }

interface Session {
  handle: string;
  screen: string;
  board: string;
  authed: boolean;
  level: string;
  bar: number;
  line: string;
  zmodem: boolean;
  ymodem: boolean;
}

function banner(w: number): string {
  const lines = [
    ' ' + c('bGreen', '██╗    ██╗  █████╗  ██████╗  ██████╗  ███████╗ ███╗   ██╗'),
    ' ' + c('bGreen', '██║    ██║ ██╔══██╗ ██╔══██╗ ██╔══██╗ ██╔════╝ ████╗  ██║'),
    ' ' + c('bGreen', '██║ █╗ ██║ ███████║ ██████╔╝ ██║  ██║ █████╗   ██╔██╗ ██║'),
    ' ' + c('bGreen', '██║███╗██║ ██╔══██║ ██╔══██╗ ██║  ██║ ██╔══╝   ██║╚██╗██║'),
    ' ' + c('bGreen', '╚███╔███╔╝ ██║  ██║ ██║  ██║ ██████╔╝ ███████╗ ██║ ╚████║'),
    ' ' + c('bGreen', ' ╚══╝╚══╝  ╚═╝  ╚═╝ ╚═╝  ╚═╝ ╚═════╝  ╚══════╝ ╚═╝  ╚═══╝'),
  ];
  return lines.join('\r\n') + '\r\n' + center(c('dim', '▓ TRM-87 · the warden mesh · ' + shortHost(myHostname()) + ' · 2400 baud ▓'), w + 2);
}

function renderConnect(s: Session, w: number): string {
  return CLS + banner(w) + '\r\n\r\n' + center(c('bWhite', 'CONNECT 2400'), w) + '\r\n' +
    center(c('dim', 'CARRIER DETECT · 8N1 · HALF DUPLEX'), w) + '\r\n\r\n' +
    center(c('inv', ' ENTER YOUR HANDLE: '), w);
}

function renderPassword(s: Session, w: number): string {
  return CLS + banner(w) + '\r\n\r\n' + center(c('bWhite', 'CALLER ' + s.handle.toUpperCase()), w) + '\r\n' +
    center(c('inv', ' ENTER YOUR PASSWORD: '), w);
}

const MENU_ITEMS: { label: string; tag: (s: Session) => string; act: string; sysop?: boolean }[] = [
  { label: 'MESSAGE AREAS', tag: () => String(listBbsBoards().length) + ' confs', act: 'boards' },
  { label: 'FILE AREAS', tag: () => String(bbsFiles().length) + ' files', act: 'files' },
  { label: 'MAIL', tag: () => { const u = countBbsUnreadMentions(shortHost(myHostname())); return u ? String(u) + ' unread' : 'inbox'; }, act: 'mail', sysop: true },
  { label: 'BULLETINS', tag: () => String(bbsBulletins().length) + ' posted', act: 'bulletins' },
  { label: "WHO'S ONLINE", tag: () => String(listFriends().filter((f) => f.status === 'online').length) + ' up', act: 'online' },
  { label: 'LAST CALLERS', tag: () => 'recent calls', act: 'online' },
  { label: 'DOORS', tag: () => 'the game room', act: 'doors' },
  { label: 'SYSOP', tag: () => 'node ledger', act: 'sysop' },
  { label: 'SEARCH', tag: () => 'grep the base', act: 'search' },
  { label: 'PROFILE', tag: (s: Session) => bbsGetProfile(s.handle) || 'not set', act: 'profile' },
];
function visibleMenu(level: string) { return MENU_ITEMS.filter((m) => !m.sysop || level === 'sysop'); }

function renderMenu(s: Session, w: number): string {
  const host = shortHost(myHostname());
  const online = listFriends().filter((f) => f.status === 'online').length;
  const bull = bbsBulletins()[0];
  const L: string[] = [];
  L.push(frameTitle(' MAIN MENU ', w));
  L.push(frameLine(c('dim', '  caller ') + c('bCyan', s.handle) + c('dim', ' · level ') + c(s.level === 'sysop' ? 'bRed' : 'bGreen', s.level.toUpperCase()) + c('dim', ' · node ') + c('bGreen', host), c('dim', online + ' nodes up'), w));
  L.push(frameLine(' ', '', w));
  const menu = visibleMenu(s.level);
  for (let i = 0; i < menu.length; i++) {
    L.push(sel(i, s, frameLine(' ' + c('dim', String(i + 1)) + '  ' + c('bWhite', menu[i].label), c('dim', menu[i].tag(s)), w)));
  }
  L.push(frameLine(' ', '', w));
  L.push(frameLine(' ' + c('dim', 'Q') + '  ' + c('bRed', 'HANG UP'), c('dim', 'drop the line'), w));
  if (bull) L.push(frameLine(c('bMagenta', '  BULLETIN ') + c('bWhite', bull.title.slice(0, w - 30)), c('dim', fmtWhen(bull.created_at)), w));
  L.push(frameFoot(w));
  return CLS + banner(w) + '\r\n\r\n' + L.join('\r\n');
}

function renderDoors(s: Session, w: number): string {
  const L: string[] = [frameTitle(' DOORS — THE GAME ROOM ', w)];
  const doors = [['◄  FORTUNE', 'a cookie from the rack'], ['?  GUESS', '1 to 100'], ['@  HANGMAN', 'six strikes, one word'], ['●  8-BALL', 'ask, shake, receive']];
  doors.forEach(([name, desc]) => L.push(frameLine(' ' + c('bRed', name), c('dim', desc), w)));
  L.push(frameLine(' ', '', w));
  L.push(frameLine(c('dim', '  play these on the web terminal (the console is browse-only for now)'), '', w));
  L.push(frameLine(' ', '', w));
  L.push(frameLine(c('dim', '  [Q] back'), '', w));
  L.push(frameFoot(w));
  return CLS + L.join('\r\n');
}

function renderSearch(s: Session, w: number): string {
  const term = s.board; // reuse the board field to hold the last search term
  const posts = listBbsPosts({ host: myHostname(), limit: 500 });
  const L: string[] = [frameTitle(' SEARCH — GREP THE BASE ', w)];
  if (!term) {
    L.push(frameLine(c('dim', '  type a term and press enter to search'), '', w));
  } else {
    const hits = posts.filter((p) => (p.body || '').toLowerCase().includes(term.toLowerCase())).slice(0, 20);
    if (!hits.length) L.push(frameLine(c('dim', '  no posts match "' + term + '"'), '', w));
    hits.forEach((p) => L.push(frameLine(' ' + c('bGreen', '[' + p.board + '] ') + c('bWhite', shortHost(p.author_host)), c('dim', p.body.replace(/\s+/g, ' ').slice(0, 40)), w)));
  }
  L.push(frameLine(' ', '', w));
  L.push(frameLine(c('dim', '  [Q] back'), '', w));
  L.push(frameFoot(w));
  return CLS + L.join('\r\n');
}

function renderBoards(s: Session, w: number): string {
  const boards = listBbsBoards();
  const posts = listBbsPosts({ host: myHostname(), limit: 500 });
  const threads = listBbsThreads({ host: myHostname() });
  const L: string[] = [frameTitle(' MESSAGE AREAS ', w)];
  for (let i = 0; i < boards.length; i++) {
    const b = boards[i];
    const n = posts.filter((p) => p.board === b.name).length;
    const t = threads.filter((x) => x.board === b.name).length;
    L.push(sel(i, s, frameLine(' ' + c('bCyan', String(i + 1)) + '  ' + c('bWhite', b.name.toUpperCase()), c('dim', n + ' msgs · ' + t + ' threads'), w)));
  }
  L.push(frameLine(' ', '', w));
  L.push(frameLine(c('dim', '  pick a conference (1-' + boards.length + ') or Q to go back'), '', w));
  L.push(frameFoot(w));
  return CLS + L.join('\r\n');
}

function renderThreads(s: Session, w: number): string {
  const threads = listBbsThreads({ host: myHostname(), board: s.board });
  const L: string[] = [frameTitle(' ' + s.board.toUpperCase() + ' ', w)];
  if (!threads.length) L.push(frameLine(c('dim', '  no threads — the board is quiet'), '', w));
  for (let i = 0; i < Math.min(threads.length, 40); i++) {
    const t = threads[i];
    L.push(frameLine(' ' + c('bCyan', String(i + 1)) + '  ' + c('bWhite', t.title.slice(0, 50)), c('dim', shortHost(t.author_host) + ' · ' + (t.post_count || 0) + ' replies'), w));
  }
  L.push(frameLine(' ', '', w));
  L.push(frameLine(c('dim', '  [Q] back'), '', w));
  L.push(frameFoot(w));
  return CLS + L.join('\r\n');
}

function renderFiles(s: Session, w: number): string {
  const files = bbsFiles();
  const L: string[] = [frameTitle(' FILE AREAS ', w)];
  if (!files.length) L.push(frameLine(c('dim', '  the rack is empty'), '', w));
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    L.push(frameLine(' ' + c('bCyan', String(i + 1)) + '  ' + c('bWhite', f.name.slice(0, 40)), c('dim', fmtSize(f.size) + ' · ' + fmtWhen(f.mtime)), w));
  }
  L.push(frameLine(' ', '', w));
  L.push(frameLine(c('dim', '  [D]/[Z]/[Y] download (x/z/ymodem) · [U] upload (xmodem) · [Q] back'), '', w));
  L.push(frameFoot(w));
  return CLS + L.join('\r\n');
}

function renderMail(s: Session, w: number): string {
  const L: string[] = [frameTitle(' MAIL — YOUR INBOX ', w)];
  if (s.level !== 'sysop') {
    L.push(frameLine(c('bRed', '  ACCESS DENIED — mail is sysop-only'), '', w));
    L.push(frameFoot(w));
    return CLS + L.join('\r\n');
  }
  const msgs = listFriendMessages(50);
  const mentions = listBbsMentions(shortHost(myHostname()), 50);
  mentions.forEach((n) => L.push(frameLine(' ' + c('bAmber', '[MENTION]') + ' <' + shortHost(n.author_host) + '>', c('dim', n.excerpt.slice(0, 40)), w)));
  msgs.forEach((m) => L.push(frameLine(' ' + c('bCyan', '[DM]') + ' <' + shortHost(m.from_hostname) + '>', c('dim', m.body.slice(0, 40)), w)));
  if (!mentions.length && !msgs.length) L.push(frameLine(c('dim', '  the inbox is empty'), '', w));
  L.push(frameLine(' ', '', w));
  L.push(frameLine(c('dim', '  [Q] back'), '', w));
  L.push(frameFoot(w));
  return CLS + L.join('\r\n');
}

function renderBulletins(s: Session, w: number): string {
  const list = bbsBulletins();
  const L: string[] = [frameTitle(' BULLETINS — FROM THE SYSOP ', w)];
  if (!list.length) L.push(frameLine(c('dim', '  no bulletins posted yet'), '', w));
  list.forEach((b) => {
    L.push(frameLine(c('bMagenta', '  ● ' + b.title.slice(0, 54)), c('dim', fmtWhen(b.created_at)), w));
    for (const line of String(b.body || '').split('\n').slice(0, 4)) L.push('   ' + line.slice(0, w - 6));
  });
  L.push(frameLine(' ', '', w));
  L.push(frameLine(c('dim', '  [Q] back'), '', w));
  L.push(frameFoot(w));
  return CLS + L.join('\r\n');
}

function renderOnline(s: Session, w: number): string {
  const friends = listFriends();
  const L: string[] = [frameTitle(" WHO'S ONLINE ", w)];
  L.push(frameLine(c('bGreen', '  ● ' + shortHost(myHostname()) + ' (this node)'), '', w));
  friends.forEach((f) => L.push(frameLine(' ' + (f.status === 'online' ? c('bGreen', '●') : c('red', '○')) + '  ' + c('bWhite', shortHost(f.id)), c('dim', f.status + (f.profile ? ' · ' + f.profile.slice(0, 30) : '')), w)));
  L.push(frameLine(' ', '', w));
  L.push(frameLine(c('dim', '  [Q] back'), '', w));
  L.push(frameFoot(w));
  return CLS + L.join('\r\n');
}

function renderSysop(s: Session, w: number): string {
  const boards = listBbsBoards();
  const posts = listBbsPosts({ host: myHostname(), limit: 500 });
  const threads = listBbsThreads({ host: myHostname() });
  const files = bbsFiles();
  const bytes = files.reduce((n, f) => n + (Number(f.size) || 0), 0);
  const L: string[] = [frameTitle(' SYSOP — NODE LEDGER ', w)];
  L.push(frameLine(c('bCyan', '  MESSAGES ' + posts.length) + '  ' + c('bCyan', 'THREADS ' + threads.length) + '  ' + c('bCyan', 'FILES ' + files.length + ' (' + fmtSize(bytes) + ')'), '', w));
  L.push(frameLine(' ', '', w));
  boards.forEach((b) => {
    const n = posts.filter((p) => p.board === b.name).length;
    L.push(frameLine('  ' + c('bWhite', b.name.padEnd(14)) + ' ' + c('bGreen', '█'.repeat(Math.min(20, n))), c('dim', String(n)), w));
  });
  L.push(frameLine(' ', '', w));
  L.push(frameLine(c('dim', '  [Q] back'), '', w));
  L.push(frameFoot(w));
  return CLS + L.join('\r\n');
}

function renderProfile(s: Session, w: number): string {
  const cur = bbsGetProfile(s.handle);
  const L: string[] = [frameTitle(' YOUR PROFILE ', w)];
  L.push(frameLine(c('dim', '  handle ') + c('bCyan', s.handle), '', w));
  L.push(frameLine(' ', '', w));
  L.push(frameLine(c('dim', '  current profile:'), '', w));
  const text = cur || '(not set yet)';
  for (const line of text.match(/.{1,70}/g) || [text]) L.push(frameLine(c('bWhite', '  ' + line), '', w));
  L.push(frameLine(' ', '', w));
  L.push(frameLine(c('dim', '  type a new profile below and press enter · [Q] to cancel'), '', w));
  L.push(frameFoot(w));
  return CLS + L.join('\r\n');
}

function renderLogoff(s: Session, w: number): string {
  return CLS + '\r\n\r\n' + center(c('bRed', 'NO CARRIER'), w) + '\r\n\r\n' +
    center(c('bGreen', 'THANK YOU FOR CALLING'), w) + '\r\n' +
    center(c('dim', '· the warden mesh · ' + shortHost(myHostname()) + ' ·'), w);
}

const RENDER: Record<string, (s: Session, w: number) => string> = {
  connect: renderConnect, password: renderPassword, menu: renderMenu, boards: renderBoards, threads: renderThreads,
  files: renderFiles, filedl: renderFiles, fileul: renderFiles, mail: renderMail, bulletins: renderBulletins, online: renderOnline,
  doors: renderDoors, search: renderSearch, sysop: renderSysop, profile: renderProfile, logoff: renderLogoff,
};

function dispatch(s: Session, line: string): void {
  const cmd = line.trim();
  switch (s.screen) {
    case 'connect':
      if (cmd) { s.handle = cmd.slice(0, 24).toLowerCase(); s.screen = 'password'; }
      break;
    case 'password': {
      const chk = bbsCheckPassword(s.handle, cmd);
      if (chk.ok) { s.authed = true; s.level = chk.level; s.screen = 'menu'; }
      else { s.handle = ''; s.screen = 'connect'; }
      break;
    }
    case 'menu': {
      const menu = visibleMenu(s.level);
      const n = parseInt(cmd, 10);
      if (n >= 1 && n <= menu.length) {
        s.screen = menu[n - 1].act;
        if (s.screen === 'search') s.board = '';
      } else if (cmd.toLowerCase() === 'q') s.screen = 'logoff';
      break;
    }
    case 'boards': {
      const n = parseInt(cmd, 10);
      if (n >= 1 && n <= listBbsBoards().length) { s.board = listBbsBoards()[n - 1].name; s.screen = 'threads'; }
      else if (cmd.toLowerCase() === 'q') s.screen = 'menu';
      break;
    }
    case 'search':
      if (cmd.toLowerCase() === 'q') s.screen = 'menu';
      else if (cmd) s.board = cmd.slice(0, 60);
      break;
    case 'files':
      if (cmd === 'd') { s.zmodem = false; s.ymodem = false; s.screen = 'filedl'; }
      else if (cmd === 'u') { s.zmodem = false; s.ymodem = false; s.screen = 'fileul'; }
      else if (cmd === 'z') { s.zmodem = true; s.ymodem = false; s.screen = 'filedl'; }
      else if (cmd === 'Z') { s.zmodem = true; s.ymodem = false; s.screen = 'fileul'; }
      else if (cmd === 'y') { s.zmodem = false; s.ymodem = true; s.screen = 'filedl'; }
      else if (cmd === 'Y') { s.zmodem = false; s.ymodem = true; s.screen = 'fileul'; }
      else if (cmd.toLowerCase() === 'q') s.screen = 'menu';
      break;
    default:
      if (cmd.toLowerCase() === 'q' || cmd.toLowerCase() === 'm') s.screen = 'menu';
      else if (cmd) s.screen = 'menu';
  }
}

/** Seed the node's own sysop login (handle = short hostname) with a password on
 *  first boot, so the console is usable immediately and mail stays private. */
function ensureSysopUser(): string {
  const h = shortHost(myHostname()).toLowerCase();
  const row = getBbsCallerPassword(h);
  if (row && row.hash) return h;
  const pw = process.env.BBS_SYSOP_PASSWORD || ('bbs_' + crypto.randomBytes(8).toString('hex'));
  bbsRegisterUser(h, pw, 'sysop');
  logger.info({ handle: h, password: pw }, 'BBS sysop user seeded — change via POST /api/friends/bbs/users');
  return h;
}

// ─── XMODEM (128-byte blocks, 8-bit checksum) ───────────────────────────────
// Classic dial-up file transfer. Download sends the file; upload receives it.
// `readByte(ms)` returns the next raw byte (or -1 on timeout). Frames are SOH +
// block# + ~block# + 128 bytes + checksum, ACK/NAK handshake, EOT at the end.
const SOH = 0x01, EOT = 0x04, ACK = 0x06, NAK = 0x15, CAN = 0x18, SUB = 0x1a;

function xmodemChecksum(b: Buffer): number { let s = 0; for (const x of b) s = (s + x) & 0xff; return s; }

async function xmodemSend(stream: any, readByte: (ms: number) => Promise<number>, data: Buffer): Promise<{ ok: boolean; error?: string }> {
  const padded = Buffer.concat([data, Buffer.alloc((128 - (data.length % 128)) % 128, SUB)]);
  const n = padded.length / 128;
  const first = await readByte(10000);
  if (first === -1 || first === CAN) return { ok: false, error: 'no xmodem receiver detected' };
  if (first !== NAK && first !== 0x43) return { ok: false, error: 'receiver did not request xmodem' };
  for (let i = 0; i < n; i++) {
    const block = padded.subarray(i * 128, (i + 1) * 128);
    const bnum = (i + 1) & 0xff;
    const frame = Buffer.concat([Buffer.from([SOH, bnum, (~bnum) & 0xff]), block, Buffer.from([xmodemChecksum(block)])]);
    let sent = false;
    for (let a = 0; a < 10 && !sent; a++) {
      stream.write(frame);
      const r = await readByte(3000);
      if (r === ACK) sent = true;
      else if (r === CAN) return { ok: false, error: 'receiver cancelled' };
    }
    if (!sent) return { ok: false, error: 'receiver stopped ACKing at block ' + (i + 1) };
  }
  stream.write(Buffer.from([EOT]));
  await readByte(3000);
  return { ok: true };
}

async function xmodemReceive(stream: any, readByte: (ms: number) => Promise<number>, maxBytes: number): Promise<{ ok: boolean; data?: Buffer; error?: string }> {
  stream.write(Buffer.from([NAK])); // signal ready
  const chunks: Buffer[] = [];
  let lastBlock = 0;
  for (;;) {
    const h = await readByte(60000);
    if (h === -1) return { ok: false, error: 'timed out waiting for sender' };
    if (h === EOT) { stream.write(Buffer.from([ACK])); break; }
    if (h === CAN) return { ok: false, error: 'sender cancelled' };
    if (h !== SOH) { stream.write(Buffer.from([NAK])); continue; }
    const bnum = await readByte(3000);
    const bnum2 = await readByte(3000);
    const block = Buffer.alloc(128);
    for (let i = 0; i < 128; i++) block[i] = await readByte(3000);
    const cksum = await readByte(3000);
    if (bnum < 0 || bnum2 < 0) { stream.write(Buffer.from([NAK])); continue; }
    if (((~bnum) & 0xff) !== bnum2) { stream.write(Buffer.from([NAK])); continue; }
    if (xmodemChecksum(block) !== cksum) { stream.write(Buffer.from([NAK])); continue; }
    if (bnum === ((lastBlock + 1) & 0xff) || bnum === lastBlock) {
      chunks.push(block); lastBlock = bnum;
      stream.write(Buffer.from([ACK]));
    } else { stream.write(Buffer.from([NAK])); }
    if (chunks.length * 128 > maxBytes) { stream.write(Buffer.from([CAN])); return { ok: false, error: 'file too large' }; }
  }
  return { ok: true, data: Buffer.concat(chunks) };
}

// ─── YMODEM (single file, CRC-16, 1024-byte blocks) ──────────────────────────
// Xmodem's successor: a filename block 0 (128 B, SOH) then 1 KB data blocks
// (STX) with CRC-16. `readByte(ms)` returns the next byte or -1 on timeout.
const STX = 0x02;

function ymodemCrc16(buf: Buffer): number {
  let crc = 0;
  for (const b of buf) {
    crc ^= (b << 8);
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc & 0xffff;
}

async function ysendBlock(stream: any, readByte: (ms: number) => Promise<number>, bnum: number, block: Buffer): Promise<boolean> {
  const hdr = block.length === 128 ? SOH : STX;
  const frame = Buffer.concat([Buffer.from([hdr, bnum & 0xff, (~bnum) & 0xff]), block, Buffer.from([ymodemCrc16(block) >> 8, ymodemCrc16(block) & 0xff])]);
  for (let a = 0; a < 10; a++) {
    stream.write(frame);
    const r = await readByte(3000);
    if (r === ACK) return true;
    if (r === CAN) return false;
  }
  return false;
}

export async function ymodemSend(stream: any, readByte: (ms: number) => Promise<number>, data: Buffer): Promise<{ ok: boolean; error?: string }> {
  const first = await readByte(10000);
  if (first !== 0x43 && first !== NAK) return { ok: false, error: 'receiver did not request ymodem' };
  const info = Buffer.alloc(128, 0);
  Buffer.from('ymodem.bin\0' + data.length + ' ', 'ascii').copy(info, 0);
  if (!(await ysendBlock(stream, readByte, 0, info))) return { ok: false, error: 'block 0 not acknowledged' };
  const padded = Buffer.concat([data, Buffer.alloc((1024 - (data.length % 1024)) % 1024, SUB)]);
  const n = padded.length / 1024;
  for (let i = 0; i < n; i++) {
    if (!(await ysendBlock(stream, readByte, i + 1, padded.subarray(i * 1024, (i + 1) * 1024)))) return { ok: false, error: 'block ' + (i + 1) + ' not acknowledged' };
  }
  stream.write(Buffer.from([EOT]));
  await readByte(3000);
  return { ok: true };
}

export async function ymodemReceive(stream: any, readByte: (ms: number) => Promise<number>, maxBytes: number): Promise<{ ok: boolean; data?: Buffer; error?: string }> {
  stream.write(Buffer.from([0x43])); // CRC request
  // block 0 (SOH, 128 B)
  let h = await readByte(60000);
  if (h !== SOH) return { ok: false, error: 'no ymodem sender' };
  const b0num = await readByte(3000); const b0num2 = await readByte(3000);
  const info = Buffer.alloc(128); for (let i = 0; i < 128; i++) info[i] = await readByte(3000);
  const c1 = await readByte(3000); const c2 = await readByte(3000);
  if (b0num !== 0 || ((~b0num) & 0xff) !== b0num2 || ymodemCrc16(info) !== ((c1 << 8) | c2)) { stream.write(Buffer.from([NAK])); return { ok: false, error: 'bad block 0' }; }
  stream.write(Buffer.from([ACK]));
  const infoStr = info.toString('ascii');
  const nul = infoStr.indexOf('\0');
  const size = parseInt((infoStr.slice(nul + 1).trim().split(/\s+/)[0]) || '0', 10) || 0;
  const chunks: Buffer[] = [];
  for (;;) {
    h = await readByte(60000);
    if (h === EOT) { stream.write(Buffer.from([ACK])); break; }
    if (h === -1) return { ok: false, error: 'timeout' };
    if (h !== STX) { stream.write(Buffer.from([NAK])); continue; }
    const bnum = await readByte(3000); const bnum2 = await readByte(3000);
    const block = Buffer.alloc(1024); for (let i = 0; i < 1024; i++) block[i] = await readByte(3000);
    const cc1 = await readByte(3000); const cc2 = await readByte(3000);
    if (((~bnum) & 0xff) !== bnum2) { stream.write(Buffer.from([NAK])); continue; }
    if (ymodemCrc16(block) !== ((cc1 << 8) | cc2)) { stream.write(Buffer.from([NAK])); continue; }
    chunks.push(block);
    stream.write(Buffer.from([ACK]));
    if (chunks.length * 1024 > maxBytes) return { ok: false, error: 'too large' };
  }
  return { ok: true, data: Buffer.concat(chunks).subarray(0, size || Buffer.concat(chunks).length) };
}

function newSession(): Session {
  return { handle: '', screen: 'connect', board: '', authed: false, level: 'guest', bar: 0, line: '', zmodem: false, ymodem: false };
}

// ─── the console session: a raw byte stream (telnet socket or SSH PTY) ─────
// Renders ANSI screens, parses arrow keys, echoes/masks input. Transport-agnostic
// so telnet and SSH serve the identical BBS.
function attachConsole(stream: any, s: Session): void {
  // byte queue for XMODEM transfers (raw bytes bypass the char parser)
  let byteResolve: ((b: number) => void) | null = null;
  let byteQueue: number[] = [];
  let xfer = false;
  const readByte = (ms: number): Promise<number> => new Promise((resolve) => {
    if (byteQueue.length) { resolve(byteQueue.shift()!); return; }
    const t = setTimeout(() => { byteResolve = null; resolve(-1); }, ms);
    byteResolve = (b) => { clearTimeout(t); resolve(b); };
  });
  const pushBytes = (buf: Buffer) => {
    for (const b of buf) {
      if (byteResolve) { const r = byteResolve; byteResolve = null; r(b); }
      else byteQueue.push(b);
    }
  };

  const redraw = () => {
    const fn = RENDER[s.screen] || renderMenu;
    let prompt = '';
    if (s.screen === 'connect') prompt = c('inv', ' HANDLE: ') + s.line + ' ';
    else if (s.screen === 'password') prompt = c('inv', ' PASSWORD: ') + c('dim', '*'.repeat(s.line.length)) + ' ';
    else if (s.screen === 'filedl') prompt = c('inv', ' DOWNLOAD FILENAME: ') + s.line + ' ';
    else if (s.screen === 'fileul') prompt = c('inv', ' UPLOAD FILENAME: ') + s.line + ' ';
    else if (s.screen === 'profile') prompt = c('inv', ' ENTER PROFILE: ') + s.line + ' ';
    else prompt = c('inv', ' ' + (s.line || '↑/↓ move · ↵ select · q back') + ' ');
    stream.write(fn(s, W) + '\r\n' + prompt);
  };

  const submit = async (line: string) => {
    const prev = s.screen;
    if (s.screen === 'filedl') {
      const name = line.trim(); s.screen = 'files'; s.line = '';
      if (!name) { redraw(); return; }
      const r = bbsFileReadBase64(name);
      if (!r.ok || r.data_base64 === undefined) { stream.write('\r\n' + c('bRed', ' NO SUCH FILE: ' + name) + '\r\n'); redraw(); return; }
      xfer = true;
      const payload = Buffer.from(r.data_base64, 'base64');
      const res = s.ymodem ? await ymodemSend(stream, readByte, payload) : s.zmodem ? await zmodemSend(stream, readByte, payload) : await xmodemSend(stream, readByte, payload);
      xfer = false;
      const proto = s.ymodem ? 'ymodem' : s.zmodem ? 'zmodem' : 'xmodem';
      stream.write('\r\n' + (res.ok ? c('bGreen', ' SENT ' + name + ' (' + proto + ')') : c('bRed', ' ' + (res.error || 'failed'))) + '\r\n');
      redraw(); return;
    }
    if (s.screen === 'fileul') {
      const name = line.trim(); s.screen = 'files'; s.line = '';
      if (!name) { redraw(); return; }
      const proto = s.ymodem ? 'ymodem' : s.zmodem ? 'zmodem' : 'xmodem';
      stream.write('\r\n' + c('bAmber', ' awaiting ' + proto + ' upload for ' + name + ' — start your sender now') + '\r\n');
      xfer = true;
      const res = s.ymodem ? await ymodemReceive(stream, readByte, 10 * 1024 * 1024) : s.zmodem ? await zmodemReceive(stream, readByte, 10 * 1024 * 1024) : await xmodemReceive(stream, readByte, 10 * 1024 * 1024);
      xfer = false;
      if (res.ok && res.data) {
        const up = bbsFileUpload(name, res.data.toString('base64'));
        stream.write('\r\n' + (up.ok ? c('bGreen', ' RECEIVED ' + (up.name || name)) : c('bRed', ' ' + (up.error || 'upload failed'))) + '\r\n');
      } else {
        stream.write('\r\n' + c('bRed', ' ' + (res.error || 'upload failed')) + '\r\n');
      }
      redraw(); return;
    }
    if (s.screen === 'profile') {
      const text = line.trim();
      s.screen = 'menu'; s.line = '';
      if (text && text.toLowerCase() !== 'q') {
        bbsSetProfile(s.handle, text);
        stream.write('\r\n' + c('bGreen', ' PROFILE SAVED') + '\r\n');
      }
      redraw(); return;
    }
    if (!line.trim() && (s.screen === 'menu' || s.screen === 'boards')) dispatch(s, String(s.bar + 1));
    else dispatch(s, line.trim());
    s.line = '';
    const n = itemCount(s);
    if (n && s.bar >= n) s.bar = n - 1;
    if (s.bar < 0) s.bar = 0;
    if (s.screen === 'logoff' && prev !== 'logoff') {
      stream.write(renderLogoff(s, W) + '\r\n');
      stream.end();
      return;
    }
    redraw();
  };

  redraw();
  let esc = '';
  stream.on('data', (chunk: any) => {
    const buf: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'binary');
    if (xfer) { pushBytes(buf); return; }
    for (const ch of buf.toString('utf-8')) {
      if (esc) {
        esc += ch;
        if (esc === '\x1b[A') { if (s.bar > 0) s.bar--; redraw(); esc = ''; }
        else if (esc === '\x1b[B') { const n = itemCount(s); if (n && s.bar < n - 1) s.bar++; redraw(); esc = ''; }
        else if (esc === '\x1b[C' || esc === '\x1b[D') { esc = ''; }
        else if (esc.length >= 5 || !'\x1b['.startsWith(esc)) esc = '';
        continue;
      }
      if (ch === '\x1b') { esc = ch; continue; }
      if (ch === '\r' || ch === '\n') { void submit(s.line); continue; }
      if (ch === '\x7f' || ch === '\x08') { s.line = s.line.slice(0, -1); redraw(); continue; }
      if (ch >= ' ' && ch <= '~') { s.line += ch; redraw(); }
    }
  });
  stream.on('close', () => { try { stream.end(); } catch {} });
  stream.on('error', () => { try { stream.destroy(); } catch {} });
}

export function startBbsd(): void {
  ensureSysopUser();
  const server = net.createServer((socket) => {
    attachConsole(socket, newSession());
  });
  server.listen(PORT, HOST, () => {
    logger.info({ port: PORT, host: HOST }, 'BBS telnet daemon listening');
  });
  server.on('error', (err: any) => {
    logger.warn({ err: err?.message ?? err }, 'BBS telnet daemon failed to bind');
  });
}

// ─── SSH console ─────────────────────────────────────────────────────────────
// Password auth reuses bbsCheckPassword (the same users as telnet). The host key
// is generated once and persisted, so a reconnect doesn't trip a key warning.
function loadOrCreateHostKey(): string {
  const p = path.join(process.cwd(), 'data', 'friends', 'ssh_host_key');
  try { return fs.readFileSync(p, 'utf-8'); } catch { /* generate below */ }
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, pem, { mode: 0o600 });
  logger.info({ path: p }, 'BBS SSH host key generated');
  return pem;
}

export function startBbsSsh(): void {
  ensureSysopUser();
  const sshPort = parseInt(process.env.BBS_SSH_PORT || '2222', 10);
  const sshHost = process.env.BBS_SSH_HOST || '0.0.0.0';
  const server = new ssh2.Server({ hostKeys: [loadOrCreateHostKey()] }, (client: any) => {
    client.on('authentication', (ctx: any) => {
      if (ctx.method !== 'password') return ctx.reject(['password']);
      const chk = bbsCheckPassword(ctx.username, ctx.password);
      if (chk.ok) { client.bbsLevel = chk.level; ctx.accept(); }
      else ctx.reject(['password']);
    });
    client.on('ready', () => {
      client.on('session', (accept: any) => {
        const session = accept();
        session.on('pty', (acceptPty: any) => { if (acceptPty) acceptPty(); });
        session.on('shell', (acceptShell: any) => {
          const stream = acceptShell();
          const s = newSession();
          s.handle = String(client.username || 'caller').toLowerCase();
          s.authed = true;
          s.level = client.bbsLevel || 'caller';
          s.screen = 'menu';
          attachConsole(stream, s);
        });
      });
    });
  });
  server.listen(sshPort, sshHost, () => {
    logger.info({ port: sshPort, host: sshHost }, 'BBS SSH daemon listening');
  });
  server.on('error', (err: any) => {
    logger.warn({ err: err?.message ?? err }, 'BBS SSH daemon failed to bind');
  });
}
