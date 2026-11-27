// ─── ZMODEM (streaming) ──────────────────────────────────────────────────────
// A self-contained ZMODEM sender + receiver: ZHEX headers, CRC-16, ZDLE
// escaping, and the ZRQINIT→ZRINIT→ZFILE→ZDATA→ZEOF→ZFIN handshake. Enough to
// transfer a file with streaming (no re-request) blocks. Dependency-free so the
// console can do ZMODEM uploads/downloads alongside XMODEM.
const ZPAD = 0x2a, ZDLE = 0x18;
const ZRQINIT = 0, ZRINIT = 1, ZACK = 3, ZFILE = 4, ZFIN = 8, ZDATA = 10, ZEOF = 11, ZCAN = 16;
const ZCRCE = 0x68, ZCRCW = 0x69, ZCRCQ = 0x6a;

function crc16(buf: Buffer, init = 0): number {
  let crc = init & 0xffff;
  for (const b of buf) {
    crc ^= (b << 8);
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc & 0xffff;
}

// ZHEX header: ZPAD ZPAD ZDLE 'Z' + type(2hex) + pos(8hex) + data(8hex) + crc(4hex) + CR LF
function zhexHeader(type: number, pos: number, data: number): Buffer {
  const body = Buffer.alloc(9);
  body[0] = type & 0xff;
  body.writeUInt32LE(pos >>> 0, 1);
  body.writeUInt32LE(data >>> 0, 5);
  const crc = crc16(body);
  const s = '**\x18Z'
    + (type & 0xff).toString(16).padStart(2, '0')
    + (pos >>> 0).toString(16).padStart(8, '0')
    + (data >>> 0).toString(16).padStart(8, '0')
    + crc.toString(16).padStart(4, '0')
    + '\r\n';
  return Buffer.from(s, 'ascii');
}

// ZDLE-escape the bytes that must not appear raw on the wire.
function zescape(data: Buffer): Buffer {
  const out: number[] = [];
  for (const b of data) {
    if (b === ZDLE || b === 0x10 || b === 0x11 || b === 0x13 || b === 0x0d || b === 0x8d) out.push(ZDLE, b);
    else out.push(b);
  }
  return Buffer.from(out);
}

// read a ZHEX header from the byte stream; returns {type, pos, data} or null.
async function readHeader(readByte: (ms: number) => Promise<number>, timeoutMs: number): Promise<{ type: number; pos: number; data: number } | null> {
  let a = -1, b = -1, c = -1, d = -1;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    a = b; b = c; c = d; d = await readByte(200);
    if (a === ZPAD && b === ZPAD && c === ZDLE && (d === 0x5a /* Z */ || d === 0x42 /* B */)) {
      if (d === 0x42) { // binary header — read 1+4+4+2 bytes
        const type = await readByte(2000);
        const pos = await readByte(2000) | (await readByte(2000) << 8) | (await readByte(2000) << 16) | (await readByte(2000) << 24);
        const dat = await readByte(2000) | (await readByte(2000) << 8) | (await readByte(2000) << 16) | (await readByte(2000) << 24);
        await readByte(2000); await readByte(2000); // crc (unchecked for our own peer)
        return { type: type & 0xff, pos: pos >>> 0, data: dat >>> 0 };
      }
      // hex header: 22 hex chars + CR LF
      let hex = '';
      for (let i = 0; i < 22; i++) { const ch = await readByte(2000); hex += String.fromCharCode(ch); }
      await readByte(2000); await readByte(2000); // CR LF
      const type = parseInt(hex.slice(0, 2), 16);
      const pos = parseInt(hex.slice(2, 10), 16);
      const dat = parseInt(hex.slice(10, 18), 16);
      if (isNaN(type)) return null;
      return { type, pos: pos >>> 0, data: dat >>> 0 };
    }
  }
  return null;
}

// read `n` bytes with ZDLE un-escaping (for ZDATA blocks, which are escaped on
// the wire, so their wire length can exceed n).
async function readUnescaped(readByte: (ms: number) => Promise<number>, n: number, timeoutMs = 5000): Promise<Buffer> {
  const out = Buffer.alloc(n);
  let i = 0;
  const t0 = Date.now();
  while (i < n && Date.now() - t0 < timeoutMs) {
    let b = await readByte(2000);
    if (b === ZDLE) b = await readByte(2000);
    out[i++] = b & 0xff;
  }
  return out;
}

// read a ZFILE/ZDATA subpacket: raw bytes with ZDLE un-escaping until a NUL.
async function readSubpacket(readByte: (ms: number) => Promise<number>, timeoutMs: number): Promise<Buffer> {
  const out: number[] = [];
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const b = await readByte(2000);
    if (b === ZDLE) { const n = await readByte(2000); if (n === 0) break; out.push(n & 0xff); }
    else if (b === -1) break;
    else out.push(b & 0xff);
  }
  return Buffer.from(out);
}

export async function zmodemSend(stream: any, readByte: (ms: number) => Promise<number>, data: Buffer): Promise<{ ok: boolean; error?: string }> {
  try {
    stream.write(zhexHeader(ZRQINIT, 0, 0));
    let h = await readHeader(readByte, 10000);
    if (!h || h.type !== ZRINIT) return { ok: false, error: 'receiver did not send ZRINIT' };
    // ZFILE + subpacket (filename, ZDLE-encoded NUL terminator)
    stream.write(zhexHeader(ZFILE, 0, 0));
    stream.write(Buffer.concat([Buffer.from('zmodem.bin'), Buffer.from([ZDLE, 0])]));
    // ZDATA streaming frames (1024 bytes each, ZCRCE continuous)
    let off = 0;
    while (off < data.length) {
      const block = data.subarray(off, Math.min(off + 1024, data.length));
      stream.write(zhexHeader(ZDATA, off, block.length));
      stream.write(zescape(block));
      stream.write(Buffer.from([ZDLE, ZCRCE]));
      const c = crc16(block);
      stream.write(Buffer.from([(c >> 8) & 0xff, c & 0xff]));
      off += block.length;
    }
    // ZEOF
    stream.write(zhexHeader(ZEOF, data.length, 0));
    h = await readHeader(readByte, 10000);
    if (!h || (h.type !== ZRINIT && h.type !== ZACK)) return { ok: false, error: 'receiver did not confirm ZEOF' };
    // ZFIN
    stream.write(zhexHeader(ZFIN, 0, 0));
    h = await readHeader(readByte, 10000);
    if (!h || h.type !== ZFIN) return { ok: false, error: 'receiver did not send ZFIN' };
    stream.write('OO');
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

export async function zmodemReceive(stream: any, readByte: (ms: number) => Promise<number>, maxBytes: number): Promise<{ ok: boolean; data?: Buffer; error?: string }> {
  try {
    stream.write(zhexHeader(ZRINIT, 0, 0));
    let h = await readHeader(readByte, 10000);
    if (!h) return { ok: false, error: 'no sender' };
    if (h.type === ZCAN) return { ok: false, error: 'sender cancelled' };
    // The sender replies to our ZRINIT with ZRQINIT then ZFILE (or straight to
    // ZFILE). Consume the ZRQINIT if present; do not send a second ZRINIT.
    if (h.type !== ZFILE) {
      if (h.type === ZRQINIT) {
        h = await readHeader(readByte, 10000);
        if (!h || h.type !== ZFILE) return { ok: false, error: 'no ZFILE after ZRQINIT' };
      } else {
        return { ok: false, error: 'unexpected frame type ' + h.type };
      }
    }
    await readSubpacket(readByte, 5000);
    // accumulate ZDATA until ZEOF
    const chunks: Buffer[] = [];
    for (;;) {
      h = await readHeader(readByte, 30000);
      if (!h) return { ok: false, error: 'timeout waiting for ZDATA' };
      if (h.type === ZEOF) break;
      if (h.type === ZCAN) return { ok: false, error: 'sender cancelled' };
      if (h.type !== ZDATA) continue;
      const len = Math.min(h.data, 1024);
      const block = await readUnescaped(readByte, len);
      // CRC type byte (ZDLE-escaped)
      let t = await readByte(2000);
      if (t === ZDLE) t = await readByte(2000);
      const c = await readByte(2000);
      const c2 = await readByte(2000);
      const wantCrc = (c << 8) | c2;
      if (crc16(block) !== wantCrc) { stream.write(zhexHeader(ZACK, h.pos, 0)); continue; }
      chunks.push(block);
      if (chunks.reduce((n, x) => n + x.length, 0) > maxBytes) return { ok: false, error: 'too large' };
      if (t === ZCRCW || t === ZCRCQ) stream.write(zhexHeader(ZACK, h.pos, 0));
    }
    const data = Buffer.concat(chunks);
    stream.write(zhexHeader(ZRINIT, 0, 0));
    h = await readHeader(readByte, 10000);
    if (!h || h.type !== ZFIN) return { ok: false, error: 'no ZFIN' };
    stream.write(zhexHeader(ZFIN, 0, 0));
    stream.write('OO');
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}
