/**
 * System usage for the dashboard: CPU, both GPUs, memory.
 */
import fs from 'fs';
import http from 'http';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

let prev = readCpu();

function readCpu(): { total: number; idle: number } {
  try {
    const line = fs.readFileSync('/proc/stat', 'utf-8').split('\n')[0];
    const n = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = (n[3] || 0) + (n[4] || 0);
    const total = n.reduce((a, b) => a + (b || 0), 0);
    return { total, idle };
  } catch {
    return { total: 0, idle: 0 };
  }
}

function cpuPct(): number {
  const now = readCpu();
  const dt = now.total - prev.total;
  const di = now.idle - prev.idle;
  prev = now;
  if (dt <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - di / dt) * 100)));
}

async function gpus(): Promise<Array<{ util: number; used: number; total: number }>> {
  try {
    const { stdout } = await execFileAsync(
      'nvidia-smi',
      ['--query-gpu=utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'],
      { timeout: 3000 },
    );
    return stdout
      .trim()
      .split('\n')
      .map((l) => l.split(',').map((x) => Number(x.trim())))
      .map(([util, used, total]) => ({ util: util || 0, used: used || 0, total: total || 0 }));
  } catch {
    return [];
  }
}

export async function handleSysRequest(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (pathname !== '/api/sys') return false;
  const g = await gpus();
  const memTotal = Math.round(os.totalmem() / 1024 / 1024);
  const memUsed = Math.round((os.totalmem() - os.freemem()) / 1024 / 1024);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ cpu: cpuPct(), gpus: g, mem: { used: memUsed, total: memTotal } }));
  return true;
}
