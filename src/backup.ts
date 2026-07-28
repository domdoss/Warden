/**
 * Backup & Restore
 *
 * Full backup  — DB files + data/ + groups/ WARDEN.md / WARDEN.md / memory / config files
 * Incremental  — Changed workspace files (groups/**) since last incremental
 *
 * All archives are stored at BACKUP_DIR (/workspace/backups/) which is
 * OUTSIDE the project directory and never mounted into agent containers.
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

function spawnAsync(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString().slice(0, 2000); });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.trim()}`));
    });
    child.on('error', reject);
  });
}
import fs from 'fs';
import path from 'path';
import { STORE_DIR, GROUPS_DIR, DATA_DIR, BACKUP_DIR } from './config.js';

/** Scan a tar archive and reject any entries with absolute paths or ../ traversal. */
async function validateTarPaths(archivePath: string): Promise<void> {
  const entries = await new Promise<string>((resolve, reject) => {
    const child = spawn('tar', ['-tzf', archivePath]);
    let out = '';
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`tar -t failed with code ${code}`));
    });
    child.on('error', reject);
  });
  for (const line of entries.split('\n')) {
    const entry = line.trim();
    if (!entry) continue;
    // Reject absolute paths and path traversal
    if (entry.startsWith('/') || entry.startsWith('\\') || entry.includes('..')) {
      throw new Error(`Unsafe path in archive: ${entry}`);
    }
  }
}
import { logger } from './logger.js';

// ─── Paths ───────────────────────────────────────────────────────────────────

const FULL_DIR   = path.join(BACKUP_DIR, 'full');
const INCR_DIR   = path.join(BACKUP_DIR, 'incremental');
const CONFIG_PATH = path.join(BACKUP_DIR, 'backup-config.json');
const INCR_MANIFEST = path.join(BACKUP_DIR, 'incr-manifest.json');

export interface BackupConfig {
  fullEnabled: boolean;
  fullSchedule: string;       // cron expression, e.g. "0 2 * * *"
  incrEnabled: boolean;
  incrSchedule: string;       // cron expression, e.g. "0 * * * *"
  retainDays: number;         // delete backups older than N days (0 = keep forever)
}

export interface BackupMeta {
  id: string;
  type: 'full' | 'incremental';
  createdAt: string;
  sizeBytes: number;
  fileCount: number;
  archivePath: string;
}

const DEFAULT_CONFIG: BackupConfig = {
  fullEnabled: true,
  fullSchedule: '0 2 * * *',   // 2 AM daily
  incrEnabled: true,
  incrSchedule: '0 * * * *',   // hourly
  retainDays: 30,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureDirs() {
  for (const d of [BACKUP_DIR, FULL_DIR, INCR_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

function dirSizeBytes(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, f.name);
      if (f.isDirectory()) walk(fp);
      else try { total += fs.statSync(fp).size; } catch {}
    }
  };
  walk(dir);
  return total;
}

function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (f.isDirectory()) walk(path.join(d, f.name));
      else n++;
    }
  };
  walk(dir);
  return n;
}

function archiveSize(p: string): number {
  try { return fs.statSync(p).size; } catch { return 0; }
}

// ─── Config ──────────────────────────────────────────────────────────────────

export function getBackupConfig(): BackupConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
    }
  } catch {}
  return { ...DEFAULT_CONFIG };
}

export function saveBackupConfig(cfg: Partial<BackupConfig>): BackupConfig {
  ensureDirs();
  const current = getBackupConfig();
  const updated = { ...current, ...cfg };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2));
  return updated;
}

// ─── List backups ─────────────────────────────────────────────────────────────

export function listBackups(): BackupMeta[] {
  ensureDirs();
  const results: BackupMeta[] = [];

  // Full backups
  for (const f of fs.readdirSync(FULL_DIR)) {
    if (!f.endsWith('.meta.json')) continue;
    try {
      const meta: BackupMeta = JSON.parse(
        fs.readFileSync(path.join(FULL_DIR, f), 'utf8')
      );
      results.push(meta);
    } catch {}
  }

  // Incremental backups
  for (const d of fs.readdirSync(INCR_DIR)) {
    const metaPath = path.join(INCR_DIR, d, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta: BackupMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      results.push(meta);
    } catch {}
  }

  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ─── Full backup ─────────────────────────────────────────────────────────────

export async function createFullBackup(): Promise<BackupMeta> {
  ensureDirs();
  const id = `full-${stamp()}`;
  const archivePath = path.join(FULL_DIR, `${id}.tar.gz`);

  // Build list of source paths that exist
  const sources: string[] = [];
  if (fs.existsSync(STORE_DIR))  sources.push(STORE_DIR);
  if (fs.existsSync(DATA_DIR))   sources.push(DATA_DIR);
  if (fs.existsSync(GROUPS_DIR)) sources.push(GROUPS_DIR);

  // Include application source code and config (missing these cost us a full day)
  const PROJECT_ROOT = process.cwd();
  const srcDirs = [
    path.join(PROJECT_ROOT, 'src'),
    path.join(PROJECT_ROOT, 'container'),
    path.join(PROJECT_ROOT, 'public'),
    path.join(PROJECT_ROOT, 'dist'),
  ];
  for (const d of srcDirs) {
    if (fs.existsSync(d)) sources.push(d);
  }
  // Include root config files
  const rootConfigs = ['package.json', 'tsconfig.json', 'WARDEN.md', 'start.sh', 'install.sh', 'install-deps.sh'];
  for (const f of rootConfigs) {
    const fp = path.join(PROJECT_ROOT, f);
    if (fs.existsSync(fp)) sources.push(fp);
  }

  if (sources.length === 0) throw new Error('No source directories found');

  // Create tar archive using spawn (exec buffers stdout and can OOM)
  const tarArgs = [
    '--exclude=*/node_modules',
    '--exclude=*/attachments',
    '--exclude=*/.cache',
    '-czf',
    archivePath,
    ...sources,
  ];

  logger.info({ id }, 'Starting full backup');
  await spawnAsync('tar', tarArgs);

  const size = archiveSize(archivePath);
  const meta: BackupMeta = {
    id,
    type: 'full',
    createdAt: new Date().toISOString(),
    sizeBytes: size,
    fileCount: 0, // archive, not counted per-file
    archivePath,
  };

  fs.writeFileSync(path.join(FULL_DIR, `${id}.meta.json`), JSON.stringify(meta, null, 2));
  logger.info({ id, sizeBytes: size }, 'Full backup complete');

  pruneOldBackups();
  return meta;
}

// ─── Incremental backup ───────────────────────────────────────────────────────

interface IncrManifest {
  [filePath: string]: number; // mtime in ms
}

function loadIncrManifest(): IncrManifest {
  try {
    if (fs.existsSync(INCR_MANIFEST))
      return JSON.parse(fs.readFileSync(INCR_MANIFEST, 'utf8'));
  } catch {}
  return {};
}

function saveIncrManifest(m: IncrManifest) {
  fs.writeFileSync(INCR_MANIFEST, JSON.stringify(m, null, 2));
}

export async function createIncrementalBackup(): Promise<BackupMeta | null> {
  ensureDirs();

  const prevManifest = loadIncrManifest();
  const newManifest: IncrManifest = { ...prevManifest };
  const changedFiles: string[] = [];

  // Walk groups directory for changes
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      // Skip node_modules
      if (entry.isDirectory() && entry.name === 'node_modules') continue;
      if (entry.isDirectory()) {
        walk(full);
      } else {
        try {
          const mtime = fs.statSync(full).mtimeMs;
          if (!prevManifest[full] || prevManifest[full] < mtime) {
            changedFiles.push(full);
            newManifest[full] = mtime;
          }
        } catch {}
      }
    }
  };

  walk(GROUPS_DIR);

  // Nothing changed — skip entirely
  if (changedFiles.length === 0) {
    logger.info('Incremental backup skipped — no files changed');
    return null;
  }

  const id = `incr-${stamp()}`;
  const backupDir = path.join(INCR_DIR, id);
  fs.mkdirSync(backupDir, { recursive: true });

  // Write file list to a temp file for tar --files-from
  const listFile = path.join(backupDir, 'filelist.txt');
  fs.writeFileSync(listFile, changedFiles.join('\n'));

  const archivePath = path.join(backupDir, 'files.tar.gz');
  await spawnAsync('tar', ['-czf', archivePath, '--files-from=' + listFile]);

  // Remove temp file list
  fs.unlinkSync(listFile);

  const meta: BackupMeta = {
    id,
    type: 'incremental',
    createdAt: new Date().toISOString(),
    sizeBytes: dirSizeBytes(backupDir),
    fileCount: changedFiles.length,
    archivePath: backupDir,
  };

  fs.writeFileSync(path.join(backupDir, 'meta.json'), JSON.stringify(meta, null, 2));
  saveIncrManifest(newManifest);

  logger.info({ id, fileCount: changedFiles.length }, 'Incremental backup complete');
  pruneOldBackups();
  return meta;
}

// ─── Restore ─────────────────────────────────────────────────────────────────

export async function restoreBackup(id: string): Promise<void> {
  // Full restore
  if (id.startsWith('full-')) {
    const archivePath = path.join(FULL_DIR, `${id}.tar.gz`);
    if (!fs.existsSync(archivePath)) throw new Error(`Backup not found: ${id}`);
    logger.warn({ id }, 'Restoring full backup — overwriting current data');
    await validateTarPaths(archivePath);
    await spawnAsync('tar', ['-xzf', archivePath, '-C', '/']);
    logger.info({ id }, 'Full restore complete');
    return;
  }

  // Incremental restore
  if (id.startsWith('incr-')) {
    const archivePath = path.join(INCR_DIR, id, 'files.tar.gz');
    if (!fs.existsSync(archivePath)) {
      logger.info({ id }, 'Incremental backup was empty — nothing to restore');
      return;
    }
    logger.warn({ id }, 'Restoring incremental backup');
    await validateTarPaths(archivePath);
    await spawnAsync('tar', ['-xzf', archivePath, '-C', '/']);
    logger.info({ id }, 'Incremental restore complete');
    return;
  }

  throw new Error(`Unknown backup id format: ${id}`);
}

// ─── Prune old backups ────────────────────────────────────────────────────────

export function pruneOldBackups(): void {
  const cfg = getBackupConfig();
  if (!cfg.retainDays || cfg.retainDays <= 0) return;

  const cutoff = Date.now() - cfg.retainDays * 24 * 60 * 60 * 1000;

  // Full backups — prune by meta.json if available, otherwise by file mtime
  for (const f of fs.readdirSync(FULL_DIR)) {
    const fullPath = path.join(FULL_DIR, f);
    if (f.endsWith('.meta.json')) {
      try {
        const meta: BackupMeta = JSON.parse(
          fs.readFileSync(fullPath, 'utf8')
        );
        if (new Date(meta.createdAt).getTime() < cutoff) {
          fs.rmSync(fullPath);
          const archive = path.join(FULL_DIR, `${meta.id}.tar.gz`);
          if (fs.existsSync(archive)) fs.rmSync(archive);
          logger.info({ id: meta.id }, 'Pruned old full backup');
        }
      } catch {}
    } else if (f.endsWith('.tar.gz')) {
      // Orphan archives without meta — prune by file modification time
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs < cutoff) {
          fs.rmSync(fullPath);
          logger.info({ file: f }, 'Pruned orphan full backup archive');
        }
      } catch {}
    }
  }

  // Incremental backups
  for (const d of fs.readdirSync(INCR_DIR)) {
    const metaPath = path.join(INCR_DIR, d, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta: BackupMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (new Date(meta.createdAt).getTime() < cutoff) {
        fs.rmSync(path.join(INCR_DIR, d), { recursive: true });
        logger.info({ id: meta.id }, 'Pruned old incremental backup');
      }
    } catch {}
  }
}

// ─── Delete a single backup ───────────────────────────────────────────────────

export function getBackupArchivePath(id: string): string | null {
  if (id.startsWith('full-')) {
    const p = path.join(FULL_DIR, `${id}.tar.gz`);
    return fs.existsSync(p) ? p : null;
  }
  if (id.startsWith('incr-')) {
    const p = path.join(INCR_DIR, id, 'files.tar.gz');
    return fs.existsSync(p) ? p : null;
  }
  return null;
}

export function deleteBackup(id: string): void {
  if (id.startsWith('full-')) {
    const archive = path.join(FULL_DIR, `${id}.tar.gz`);
    const meta    = path.join(FULL_DIR, `${id}.meta.json`);
    if (fs.existsSync(archive)) fs.rmSync(archive);
    if (fs.existsSync(meta))    fs.rmSync(meta);
    return;
  }
  if (id.startsWith('incr-')) {
    const dir = path.join(INCR_DIR, id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
    return;
  }
  throw new Error(`Unknown backup id: ${id}`);
}
