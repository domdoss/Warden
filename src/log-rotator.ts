import fs from 'node:fs';

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB cap
const DEFAULT_KEEP_BYTES = 4 * 1024 * 1024; // keep the last ~4 MB (tail) on trim
const DEFAULT_CHECK_MS = 30_000;

/**
 * Cap a log file at `max` bytes by trimming the HEAD in place — copytruncate
 * semantics: read the tail, then truncate + rewrite the SAME inode. This is
 * safe alongside an external O_APPEND writer (e.g. systemd
 * StandardOutput=append): its fd stays valid and subsequent appends land right
 * after the kept tail, so logging never orphans. A line appended in the
 * microsecond window between read and truncate is dropped — acceptable for a
 * log. The trim is snapped to a newline so whole lines are preserved.
 *
 * Call once at startup; returns the interval handle.
 */
export function startLogCap(
  file: string,
  max: number = DEFAULT_MAX_BYTES,
  keep: number = DEFAULT_KEEP_BYTES,
  checkMs: number = DEFAULT_CHECK_MS,
): NodeJS.Timeout {
  const trim = () => {
    try {
      const st = fs.statSync(file);
      if (st.size <= max) return;
      const start = Math.max(0, st.size - keep);
      const fd = fs.openSync(file, 'r');
      const len = st.size - start;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      fs.closeSync(fd);
      // Drop a partial first line so the kept tail starts on a line boundary.
      const nl = buf.indexOf('\n');
      const tail = nl >= 0 ? buf.subarray(nl + 1) : buf;
      // 'w' opens the EXISTING inode with O_TRUNC — same inode, so systemd's
      // O_APPEND fd keeps writing at the new end-of-file.
      fs.writeFileSync(file, tail);
    } catch {
      // File missing / transient race — nothing to trim this round.
    }
  };
  return setInterval(trim, checkMs);
}