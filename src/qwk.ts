// ─── QWK offline mail ────────────────────────────────────────────────────────
// A QWK packet is a ZIP (stored, uncompressed) of MESSAGES.DAT + CONTROL.DAT +
// HELLO. MESSAGES.DAT is a stream of 128-byte headers + bodies, separated by
// \xE3 (0xE3) between messages and terminated by \xE2 (0xE2). This module builds
// a packet for export and parses a REP packet for import. STORE-only ZIP is all
// QWK readers need, and it keeps us dependency-free.
import { listBbsBoards, listBbsPosts, listBbsThreads } from './db.js';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf-8');
    const crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 8);              // method = 0 (store)
    lh.writeUInt16LE(0x21, 12);          // DOS date
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(f.data.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, f.data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 10); ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(f.data.length, 20); ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + f.data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, eocd]);
}

export function unzipStore(buf: Buffer): { name: string; data: Buffer }[] {
  const out: { name: string; data: Buffer }[] = [];
  let i = 0;
  while (i + 4 <= buf.length) {
    const sig = buf.readUInt32LE(i);
    if (sig === 0x04034b50) {
      const method = buf.readUInt16LE(i + 8);
      const comp = buf.readUInt32LE(i + 18);
      const nameLen = buf.readUInt16LE(i + 26);
      const extraLen = buf.readUInt16LE(i + 28);
      const name = buf.subarray(i + 30, i + 30 + nameLen).toString('utf-8');
      const start = i + 30 + nameLen + extraLen;
      if (method === 0) out.push({ name, data: buf.subarray(start, start + comp) });
      i = start + comp;
    } else if (sig === 0x02014b50 || sig === 0x06054b50) break;
    else i++;
  }
  return out;
}

function pad(s: string, n: number): string { return String(s || '').slice(0, n).padEnd(n, ' '); }
function pad2(n: number): string { return String(n).padStart(2, '0'); }

/** Build a QWK packet for this node's message base (newest first). */
export function buildQwkPacket(host: string): Buffer {
  const boards = listBbsBoards();
  const posts = listBbsPosts({ host, limit: 200 });
  const threadTitles = new Map(listBbsThreads({ host }).map((t) => [t.id, t.title]));
  const msgs: Buffer[] = [];
  posts.forEach((p, idx) => {
    const conf = Math.max(0, boards.findIndex((b) => b.name === p.board));
    const h = Buffer.alloc(128, 0x20); // fill with spaces (0x20)
    const write = (off: number, len: number, s: string | number) => Buffer.from(pad(String(s), len), 'utf-8').copy(h, off);
    write(1, 7, idx + 1);
    const d = new Date(p.created_at || Date.now());
    write(8, 8, `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${String(d.getFullYear()).slice(2)}`);
    write(16, 5, `${pad2(d.getHours())}:${pad2(d.getMinutes())}`);
    write(21, 25, 'ALL');
    write(46, 25, p.author_host);
    write(71, 25, p.thread_id ? threadTitles.get(p.thread_id) || '(reply)' : '(shoutbox)');
    write(96, 12, 'WARDEN');
    write(108, 8, idx + 1);
    const body = Buffer.from((p.body || '').replace(/\r?\n/g, '\r'), 'utf-8');
    const blocks = Math.ceil((128 + body.length + 1) / 128);
    write(116, 3, blocks);
    write(120, 2, conf);
    msgs.push(Buffer.concat([h, body]));
  });
  let messages = Buffer.alloc(0);
  msgs.forEach((m, i) => {
    messages = Buffer.concat([messages, m, Buffer.from([i < msgs.length - 1 ? 0xe3 : 0xe2])]);
  });
  const control = ['WARDEN', 'Tailscale', host, '0', '', '', '', '', '', '',
    ...boards.map((b) => b.name), 'DOOR=WARDEN', '0', 'HELLO', ''].join('\r\n');
  const hello = 'Welcome to the Warden BBS. Read this packet with any QWK reader.\r\n';
  return zipStore([
    { name: 'MESSAGES.DAT', data: messages },
    { name: 'CONTROL.DAT', data: Buffer.from(control, 'utf-8') },
    { name: 'HELLO', data: Buffer.from(hello, 'utf-8') },
  ]);
}

/** Parse a REP packet (the upload side of QWK) into reply messages. */
export function parseRepPacket(packet: Buffer): { from: string; to: string; subject: string; body: string }[] {
  const files = unzipStore(packet);
  const replyFile = files.find((f) => /^REPLY\.DAT$/i.test(f.name) || /\.REP$/i.test(f.name) || /^MESSAGES\.DAT$/i.test(f.name));
  if (!replyFile) return [];
  const buf = replyFile.data;
  const blocks: Buffer[] = [];
  let cur = Buffer.alloc(0);
  for (const b of buf) {
    if (b === 0xe2) { blocks.push(cur); cur = Buffer.alloc(0); }
    else cur = Buffer.concat([cur, Buffer.from([b])]);
  }
  if (cur.length) blocks.push(cur);
  const out: { from: string; to: string; subject: string; body: string }[] = [];
  for (const blk of blocks) {
    if (blk.length < 128) continue;
    const header = blk.subarray(0, 128);
    const body = blk.subarray(128).toString('utf-8').replace(/\r/g, '').trim();
    if (!body) continue;
    out.push({
      to: header.subarray(21, 46).toString('utf-8').trim(),
      from: header.subarray(46, 71).toString('utf-8').trim(),
      subject: header.subarray(71, 96).toString('utf-8').trim(),
      body,
    });
  }
  return out;
}
