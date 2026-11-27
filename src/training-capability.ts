import { spawnSync } from 'child_process';

/**
 * Can this machine run the local training loop?
 *
 * The loop is a CUDA job: the granite-8b LoRA (~17.9k ctx) runs within ~300 MiB
 * of a 16 GB card's limit, so it needs an NVIDIA GPU with **16 GB or more**
 * VRAM (a 16 GB card runs it; 12 GB and below cannot). Apple Silicon is
 * intentionally not counted yet — the trainer is CUDA-only; Mac support
 * arrives with the Mac build.
 */
export interface TrainingCapability {
  kind: 'nvidia' | 'none';
  gb: number; // largest GPU's total VRAM in GiB (0 = none)
  requiredGb: number;
  locked: boolean;
}

export const TRAINING_REQUIRED_GB = 16;

export function detectTrainingCapability(): TrainingCapability {
  let bestMiB = 0;
  let kind: 'nvidia' | 'none' = 'none';
  try {
    const r = spawnSync(
      'nvidia-smi',
      ['--query-gpu=memory.total', '--format=csv,noheader,nounits'],
      { encoding: 'utf8', timeout: 4000 },
    );
    if (r.status === 0 && r.stdout) {
      const mibs = r.stdout
        .split('\n')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (mibs.length) {
        kind = 'nvidia';
        bestMiB = Math.max(...mibs);
      }
    }
  } catch {
    /* no nvidia-smi — treated as no capable GPU */
  }
  const gb = Math.round((bestMiB / 1024) * 10) / 10;
  return {
    kind,
    gb,
    requiredGb: TRAINING_REQUIRED_GB,
    // 16 GB or more — a 16 GB card is the documented minimum that fits the run.
    locked: !(kind === 'nvidia' && bestMiB >= TRAINING_REQUIRED_GB * 1024),
  };
}
