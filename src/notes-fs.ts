// --- Notes (Obsidian-inspired) — filesystem-backed ---
//
// Storage is the real filesystem, not SQLite. The "vault root" is
// ~/Documents/Notes; notes are .md files anywhere under it. The corpus (tags,
// backlinks, [[link]] resolution, search) is indexed only from that subtree,
// skipping dot-dirs and node_modules. Keeping the root scoped to a dedicated
// notes folder stops the corpus from being flooded by the tens of thousands
// of unrelated .md files (READMEs, skill docs, etc.) that live across the rest
// of the home directory.
//
// The corpus (every .md file under the root + its parsed tags/links) is cached
// in memory for CORPUS_TTL ms and invalidated on every write, so tags/backlinks
// refresh on save without re-walking the tree on every keystroke.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { DATA_DIR } from './config.js';

export const NOTES_ROOT = path.join(os.homedir(), 'Documents', 'Notes');

// --- ignore store (JSON sidecar under DATA_DIR; data/ is gitignored) ---
//
// A user can ignore individual notes or whole folders. Ignored entries are
// excluded from the corpus (tags, folders, [[link]] resolution, backlinks,
// search) and from the normal folder browse list; they surface in the
// dedicated "Ignored" view where they can be restored.

const IGNORE_FILE = path.join(DATA_DIR, 'notes-ignore.json');

interface IgnoreState {
  paths: string[]; // ignored absolute file paths
  folders: string[]; // ignored absolute folder paths (ignore everything under)
}

let ignoreState: IgnoreState | null = null;

function loadIgnore(): IgnoreState {
  if (ignoreState) return ignoreState;
  try {
    const raw = fs.readFileSync(IGNORE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<IgnoreState>;
    ignoreState = { paths: parsed.paths || [], folders: parsed.folders || [] };
  } catch {
    ignoreState = { paths: [], folders: [] };
  }
  return ignoreState;
}

function saveIgnore(): void {
  if (!ignoreState) return;
  try {
    fs.mkdirSync(path.dirname(IGNORE_FILE), { recursive: true });
    fs.writeFileSync(IGNORE_FILE, JSON.stringify(ignoreState, null, 2), 'utf8');
  } catch {
    // best-effort; ignore IO failures
  }
}

export function isIgnored(abs: string): boolean {
  const s = loadIgnore();
  if (s.paths.includes(abs)) return true;
  for (const f of s.folders) {
    if (abs === f || abs.startsWith(f + path.sep)) return true;
  }
  return false;
}

export function ignorePath(abs: string): void {
  const s = loadIgnore();
  if (!s.paths.includes(abs)) s.paths.push(abs);
  // Drop any narrower folder-ignore that would subsume it? Keep both; harmless.
  saveIgnore();
  invalidateCorpus();
}

export function ignoreFolder(abs: string): void {
  const s = loadIgnore();
  const f = abs.replace(/[/\\]+$/, '');
  if (!s.folders.includes(f)) s.folders.push(f);
  // Drop file-ignores now covered by this folder.
  s.paths = s.paths.filter((p) => !(p === f || p.startsWith(f + path.sep)));
  saveIgnore();
  invalidateCorpus();
}

export function unignoreEntry(entry: { path?: string; folder?: string }): void {
  const s = loadIgnore();
  if (entry.path) s.paths = s.paths.filter((p) => p !== entry.path);
  if (entry.folder) s.folders = s.folders.filter((p) => p !== entry.folder);
  saveIgnore();
  invalidateCorpus();
}

export interface IgnoredFile {
  path: string;
  rel: string;
  title: string;
  exists: boolean;
}
export interface IgnoredFolder {
  path: string;
  rel: string;
  exists: boolean;
  count: number; // .md files under it in the current corpus
}

export function listIgnored(): { files: IgnoredFile[]; folders: IgnoredFolder[] } {
  const s = loadIgnore();
  const corpus = getCorpus();
  const files: IgnoredFile[] = s.paths.map((p) => {
    const st = statOrNull(p);
    return { path: p, rel: relToRoot(p), title: path.basename(p, '.md'), exists: !!(st && st.isFile()) };
  });
  const folders: IgnoredFolder[] = s.folders.map((f) => {
    const st = statOrNull(f);
    const count = corpus.filter((e) => e.abs === f || e.abs.startsWith(f + path.sep)).length;
    return { path: f, rel: relToRoot(f), exists: !!(st && st.isDirectory()), count };
  });
  return { files, folders };
}

export interface NoteMeta {
  path: string; // absolute path
  rel: string; // relative to NOTES_ROOT (may contain ../ when outside home)
  title: string; // filename stem
  uid: string; // slugify(stem) — [[link]] target
  folder: string; // containing dir, relative to NOTES_ROOT ('' = root)
  mtime: number;
  size: number;
}

export interface Note extends NoteMeta {
  body: string;
}

export interface NoteBacklink {
  path: string;
  rel: string;
  title: string;
}

export interface NoteTagCount {
  tag: string;
  count: number;
}

export interface NoteFolderCount {
  folder: string;
  count: number;
}

interface CorpusEntry {
  abs: string;
  rel: string;
  title: string;
  uid: string;
  body: string;
  tags: string[];
  links: string[]; // target uids
  mtime: number;
  size: number;
}

let corpusCache: { entries: CorpusEntry[]; ts: number } | null = null;
const CORPUS_TTL = 60000;

// --- slug / link / tag parsing (unchanged from the SQLite version) ---

function slugifyUid(title: string): string {
  return String(title == null ? '' : title)
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'untitled';
}

function parseNoteLinks(body: string): { dst_uid: string; label: string | null; ord: number }[] {
  const out: { dst_uid: string; label: string | null; ord: number }[] = [];
  const re = /\[\[([^\]|#\[]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const target = (m[1] || '').trim();
    if (!target) continue;
    out.push({ dst_uid: slugifyUid(target), label: m[2] ? m[2].trim() : null, ord: out.length });
  }
  return out;
}

function parseNoteTags(body: string): string[] {
  const tags = new Set<string>();
  const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    const tagsLine = fm[1].match(/^tags:\s*\[(.*)\]/m);
    if (tagsLine) {
      tagsLine[1]
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
        .forEach((t) => tags.add(t));
    }
  }
  const re = /(?:^|\s)#([A-Za-z][\w-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) tags.add(m[1]);
  return [...tags];
}

// --- path helpers ---

// Resolve a folder the client sent: absolute paths are used as-is (full fs
// access); relative paths resolve against NOTES_ROOT.
export function resolveFolder(folder: string | undefined | null): string {
  if (!folder) return NOTES_ROOT;
  const f = folder.trim();
  if (!f) return NOTES_ROOT;
  return path.isAbsolute(f) ? path.resolve(f) : path.resolve(NOTES_ROOT, f);
}

function sanitizeFilename(title: string): string {
  const base = String(title == null ? '' : title).trim() || 'Untitled';
  // Strip path separators and other filesystem-hostile chars.
  return base.replace(/[/\\]/g, '-').replace(/^[.]+/, '').trim() || 'Untitled';
}

function relToRoot(abs: string): string {
  const r = path.relative(NOTES_ROOT, abs);
  return r === '' ? '.' : r;
}

function folderOf(abs: string): string {
  const dir = path.dirname(abs);
  const r = path.relative(NOTES_ROOT, dir);
  if (r === '') return '';
  if (r.startsWith('..')) return dir; // outside home → absolute folder
  return r;
}

function statOrNull(abs: string): fs.Stats | null {
  try {
    return fs.statSync(abs);
  } catch {
    return null;
  }
}

function metaFromAbs(abs: string, st: fs.Stats): NoteMeta {
  const stem = path.basename(abs, '.md');
  return {
    path: abs,
    rel: relToRoot(abs),
    title: stem,
    uid: slugifyUid(stem),
    folder: folderOf(abs),
    mtime: st.mtimeMs,
    size: st.size,
  };
}

// --- corpus (cached walk of the home subtree) ---

function walkMd(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  const seen = new Set<string>(); // realpath guard against symlink cycles
  while (stack.length) {
    const dir = stack.pop() as string;
    let real: string;
    try {
      real = fs.realpathSync(dir);
    } catch {
      continue;
    }
    if (seen.has(real)) continue;
    seen.add(real);
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const full = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.lstatSync(full);
      } catch {
        continue;
      }
      // Skip symlinks entirely — prevents cycles and indexing outside the tree.
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        // Skip dot-dirs, node_modules, and user-ignored folders.
        if (name.startsWith('.') || name === 'node_modules') continue;
        if (isIgnored(full)) continue;
        stack.push(full);
      } else if (st.isFile() && name.toLowerCase().endsWith('.md')) {
        if (isIgnored(full)) continue;
        out.push(full);
      }
    }
  }
  return out;
}

function buildCorpus(): CorpusEntry[] {
  const files = walkMd(NOTES_ROOT);
  const entries: CorpusEntry[] = [];
  for (const abs of files) {
    let body = '';
    let st: fs.Stats | null = statOrNull(abs);
    if (!st) continue;
    try {
      body = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const stem = path.basename(abs, '.md');
    entries.push({
      abs,
      rel: relToRoot(abs),
      title: stem,
      uid: slugifyUid(stem),
      body,
      tags: parseNoteTags(body),
      links: parseNoteLinks(body).map((l) => l.dst_uid),
      mtime: st.mtimeMs,
      size: st.size,
    });
  }
  return entries;
}

function getCorpus(): CorpusEntry[] {
  const now = Date.now();
  if (corpusCache && now - corpusCache.ts < CORPUS_TTL) return corpusCache.entries;
  const entries = buildCorpus();
  corpusCache = { entries, ts: now };
  return entries;
}

function invalidateCorpus(): void {
  corpusCache = null;
}

function metaFromEntry(e: CorpusEntry): NoteMeta {
  return { path: e.abs, rel: e.rel, title: e.title, uid: e.uid, folder: folderOf(e.abs), mtime: e.mtime, size: e.size };
}

// --- listing / browsing ---

export interface ListResult {
  notes: NoteMeta[];
  dirs: string[]; // subdirectory names in folder
  folder: string; // absolute folder listed
  root: string; // NOTES_ROOT (home)
  parent: string | null; // absolute parent dir, or null at /
}

export function listNotes(filter?: { folder?: string; tag?: string; q?: string }): ListResult {
  const folder = resolveFolder(filter?.folder);

  // Tag / search filters operate over the whole home corpus (recursive).
  if (filter?.tag || filter?.q) {
    let entries = getCorpus();
    if (filter.tag) entries = entries.filter((e) => e.tags.includes(filter.tag as string));
    if (filter.q) {
      const q = filter.q.toLowerCase();
      entries = entries.filter((e) => e.title.toLowerCase().includes(q) || e.body.toLowerCase().includes(q));
    }
    const notes = entries.map(metaFromEntry).sort((a, b) => b.mtime - a.mtime);
    return { notes, dirs: [], folder, root: NOTES_ROOT, parent: parentOf(folder) };
  }

  // Plain folder browse: list .md files + subdirs directly in this dir.
  const notes: NoteMeta[] = [];
  const dirs: string[] = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(folder);
  } catch {
    return { notes, dirs, folder, root: NOTES_ROOT, parent: parentOf(folder) };
  }
  for (const name of names) {
    const full = path.join(folder, name);
    const st = statOrNull(full);
    if (!st) continue;
    if (st.isDirectory()) {
      if (!isIgnored(full)) dirs.push(name);
    } else if (st.isFile() && name.toLowerCase().endsWith('.md')) {
      if (!isIgnored(full)) notes.push(metaFromAbs(full, st));
    }
  }
  notes.sort((a, b) => b.mtime - a.mtime);
  dirs.sort((a, b) => a.localeCompare(b));
  return { notes, dirs, folder, root: NOTES_ROOT, parent: parentOf(folder) };
}

function parentOf(absDir: string): string | null {
  const p = path.dirname(absDir);
  if (p === absDir) return null; // reached /
  return p;
}

// Flat index of the whole corpus — used by the frontend for [[link]] resolution
// and autocomplete.
export function corpusIndex(): NoteMeta[] {
  return getCorpus().map(metaFromEntry);
}

// --- single note CRUD ---

export function getNote(abs: string): Note | undefined {
  const st = statOrNull(abs);
  if (!st || !st.isFile()) return undefined;
  let body = '';
  try {
    body = fs.readFileSync(abs, 'utf8');
  } catch {
    return undefined;
  }
  return { ...metaFromAbs(abs, st), body };
}

function uniquePath(dir: string, title: string): string {
  const base = sanitizeFilename(title);
  let candidate = path.join(dir, base + '.md');
  let n = 2;
  while (statOrNull(candidate)) {
    candidate = path.join(dir, `${base}-${n++}.md`);
  }
  return candidate;
}

export function createNote(input: { title: string; body?: string; folder?: string }): Note {
  const dir = resolveFolder(input.folder);
  const abs = uniquePath(dir, input.title);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(abs, input.body ?? '', 'utf8');
  invalidateCorpus();
  return getNote(abs)!;
}

export function updateNote(
  abs: string,
  updates: { title?: string; body?: string; folder?: string },
): Note | undefined {
  const existing = getNote(abs);
  if (!existing) return undefined;

  const newTitle = updates.title !== undefined ? updates.title.trim() || 'Untitled' : existing.title;
  const newBody = updates.body !== undefined ? updates.body : existing.body;
  const newDir = updates.folder !== undefined ? resolveFolder(updates.folder) : path.dirname(abs);

  const renameNeeded = updates.title !== undefined && sanitizeFilename(newTitle) + '.md' !== path.basename(abs);
  const moveNeeded = updates.folder !== undefined && path.resolve(newDir) !== path.resolve(path.dirname(abs));

  let target = abs;
  if (renameNeeded || moveNeeded) {
    const dir = moveNeeded ? newDir : path.dirname(abs);
    const name = renameNeeded ? sanitizeFilename(newTitle) + '.md' : path.basename(abs);
    target = path.join(dir, name);
    if (statOrNull(target) && path.resolve(target) !== path.resolve(abs)) {
      // disambiguate to avoid clobbering an existing file
      const base = sanitizeFilename(newTitle);
      let n = 2;
      while (statOrNull(path.join(dir, `${base}-${n}.md`))) n++;
      target = path.join(dir, `${base}-${n}.md`);
    }
    fs.mkdirSync(dir, { recursive: true });
    if (path.resolve(target) !== path.resolve(abs)) {
      fs.renameSync(abs, target);
    }
  }

  fs.writeFileSync(target, newBody, 'utf8');
  invalidateCorpus();
  return getNote(target);
}

export function deleteNote(abs: string): boolean {
  if (!statOrNull(abs)) return false;
  try {
    fs.unlinkSync(abs);
  } catch {
    return false;
  }
  invalidateCorpus();
  return true;
}

export function moveNote(abs: string, folder: string): Note | undefined {
  const existing = getNote(abs);
  if (!existing) return undefined;
  const dir = resolveFolder(folder);
  const target = path.join(dir, path.basename(abs));
  if (path.resolve(target) === path.resolve(abs)) return existing;
  if (statOrNull(target)) return undefined; // destination exists
  fs.mkdirSync(dir, { recursive: true });
  fs.renameSync(abs, target);
  invalidateCorpus();
  return getNote(target);
}

// --- graph / tags / folders (derived from the corpus) ---

export function getBacklinks(abs: string): NoteBacklink[] {
  const stem = path.basename(abs, '.md');
  const uid = slugifyUid(stem);
  return getCorpus()
    .filter((e) => e.links.includes(uid) && path.resolve(e.abs) !== path.resolve(abs))
    .map((e) => ({ path: e.abs, rel: e.rel, title: e.title }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function listNoteTags(): NoteTagCount[] {
  const counts = new Map<string, number>();
  for (const e of getCorpus()) for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function listNoteFolders(): NoteFolderCount[] {
  const counts = new Map<string, number>();
  for (const e of getCorpus()) {
    const f = folderOf(e.abs);
    if (!f || f.startsWith('..')) continue; // skip root + outside-home
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return [...counts.entries()].map(([folder, count]) => ({ folder, count })).sort((a, b) => a.folder.localeCompare(b.folder));
}