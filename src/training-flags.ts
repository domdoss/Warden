// Artemis's trainable-error flags — the hand-off from an audit to the training
// loop. Artemis confirms a fine-tunable failure (the model chose badly while
// the tool worked) and flags it with `flag_training_error`; this module stores
// the flag as one JSON line. The loop's modify step
// (training/loop/modify-parts.mjs) folds every pending flag in alongside the
// newest audit catalog, writes the corrective SFT rows, and stamps the flag
// consumed. Entries use the catalog's failure shape (id, detected_by,
// log_excerpt, classification) so both sources flow through one writer.
//
// Code/config defects are never flaggable — the class enum only holds
// fine-tunable classes. A pair teaching around a bug trains the model to work
// around it (data/skills/log-mining/SKILL.md).
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const FLAGS_FILE = path.join(process.cwd(), 'training', 'loop', 'flags', 'artemis-flags.jsonl');

export const TRAINABLE_CLASSES = [
  'wrong_tool',
  'bad_arguments',
  'narrated_no_call',
  'call_as_text',
  'wrong_shape',
  'dead_end_no_tools',
  'refusal',
  'hallucinated_answer',
] as const;

export interface TrainingFlag {
  id: string;
  flagged_at: string;
  status: 'pending' | 'consumed';
  detected_by: string[];
  log_timestamp: string;
  log_excerpt: string;
  classification: {
    failure_class: string;
    what_went_wrong: string;
    correct_behavior: string;
    sft_correction_hint: string;
    candidate_role: 'seat' | 'orch';
    tools_relevant: string[];
  };
  // Set by modify-parts.mjs when it processes the flag.
  consumed_at?: string;
  outcome?: string;
}

export function listTrainingFlags(): TrainingFlag[] {
  if (!fs.existsSync(FLAGS_FILE)) return [];
  const out: TrainingFlag[] = [];
  for (const line of fs.readFileSync(FLAGS_FILE, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn line is skipped, the rest stand */ }
  }
  return out;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Validate + append one flag. Duplicate excerpts return the existing id. */
export function addTrainingFlag(args: any): { ok: true; id: string; duplicate: boolean } | { ok: false; error: string } {
  const failureClass = str(args?.failure_class);
  if (!(TRAINABLE_CLASSES as readonly string[]).includes(failureClass)) {
    return { ok: false, error: `failure_class must be one of: ${TRAINABLE_CLASSES.join(', ')}` };
  }
  const excerpt = str(args?.log_excerpt);
  const wrong = str(args?.what_went_wrong);
  const correct = str(args?.correct_behavior);
  if (!excerpt) return { ok: false, error: 'log_excerpt is required: the verbatim log lines of the failed call' };
  if (!wrong) return { ok: false, error: 'what_went_wrong is required' };
  if (!correct) return { ok: false, error: 'correct_behavior is required' };

  const hash = crypto.createHash('sha1').update(excerpt).digest('hex').slice(0, 10);
  const id = `a-${hash}`;
  const existing = listTrainingFlags().find((f) => f.id === id);
  if (existing) return { ok: true, id, duplicate: true };

  const tools = Array.isArray(args?.tools_relevant) ? args.tools_relevant.map(str).filter(Boolean) : [];
  const flag: TrainingFlag = {
    id,
    flagged_at: new Date().toISOString(),
    status: 'pending',
    detected_by: ['artemis'],
    log_timestamp: str(args?.log_timestamp),
    log_excerpt: excerpt.slice(0, 3000),
    classification: {
      failure_class: failureClass,
      what_went_wrong: wrong,
      correct_behavior: correct,
      sft_correction_hint: correct,
      candidate_role: args?.role === 'orch' ? 'orch' : 'seat',
      tools_relevant: tools,
    },
  };
  fs.mkdirSync(path.dirname(FLAGS_FILE), { recursive: true });
  fs.appendFileSync(FLAGS_FILE, JSON.stringify(flag) + '\n');
  return { ok: true, id, duplicate: false };
}
