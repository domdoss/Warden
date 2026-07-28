/**
 * PII Scrubber — TypeScript port of groups/telegram_main/scrubber/scrub.js
 * with added Ollama AI review pass.
 *
 * Two-pass scrubbing:
 *   1. Regex/dictionary pass — deterministic, fast
 *   2. Ollama AI pass — catches contextual PII the regex missed
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { logger } from './logger.js';
import { OLLAMA_URL } from './config.js';

// --- Types ---

export interface Dictionary {
  people: string[];
  companies: string[];
  projects: string[];
  locations: string[];
  [key: string]: string[];
}

export interface Mapping {
  [placeholder: string]: string;
}

export interface ScrubResult {
  scrubbed: string;
  mapping: Mapping;
  warnings: string[];
  ollamaUsed?: boolean;
}

export interface VaultEntry {
  id: string;
  originalPath: string;
  originalName: string;
  scrubDate: string;
  status: 'scrubbed' | 'recombined';
}

// --- Constants ---

const VAULT_DIR = path.resolve(process.cwd(), 'data/pii-vault');
const SCRUBBED_DIR = path.join(VAULT_DIR, 'scrubbed');
const MAPPINGS_DIR = path.join(VAULT_DIR, 'mappings');
const INDEX_PATH = path.join(VAULT_DIR, 'index.json');
const DICT_PATH = path.resolve(process.cwd(), 'data/pii-vault/dictionary.json');

function getOllamaConfig() {
  // Read at call time so settings changes take effect without restart
  const url = process.env.OLLAMA_URL || OLLAMA_URL;
  return {
    url,
    model: process.env.OLLAMA_MODEL || 'nemotron-3-super:cloud',
  };
}

const PLACEHOLDER_PREFIXES: Record<string, string> = {
  person: 'PERSON',
  company: 'COMPANY',
  project: 'PROJECT',
  location: 'LOCATION',
  date: 'DATE',
  money: 'AMOUNT',
  email: 'EMAIL',
  phone: 'PHONE',
  ssn: 'SSN',
  sin: 'SIN',
  account: 'ACCOUNT',
  address: 'ADDRESS',
  creditcard: 'CREDITCARD',
  ip: 'IP',
  dob: 'DOB',
};

const PATTERNS: Array<{ type: string; regex: RegExp }> = [
  // SIN (Canadian Social Insurance Number: 3-3-3)
  { type: 'sin', regex: /\b\d{3}-\d{3}-\d{3}\b/g },
  // SSN (US: 3-2-4)
  { type: 'ssn', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  // Credit card (13-19 digits with optional separators)
  {
    type: 'creditcard',
    regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{1,7}\b/g,
  },
  // Email
  {
    type: 'email',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  // Phone numbers
  {
    type: 'phone',
    regex: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  },
  // IP addresses
  { type: 'ip', regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  // Money with symbol
  {
    type: 'money',
    regex:
      /(?:\$|USD\s?|CAD\s?|EUR\s?|GBP\s?)\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?(?:\s?(?:million|billion|thousand|[KkMmBb]))?\b/g,
  },
  // Money without symbol
  {
    type: 'money',
    regex:
      /\b\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s+(?:million|billion|thousand)\s+(?:dollars?|USD|CAD)\b/gi,
  },
  // Dates: March 5, 2026
  {
    type: 'date',
    regex:
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi,
  },
  // Dates: 03/05/2026
  { type: 'date', regex: /\b\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}\b/g },
  // Dates: 2026-03-05
  { type: 'date', regex: /\b\d{4}-\d{2}-\d{2}\b/g },
  // Account/reference numbers
  {
    type: 'account',
    regex: /\b(?:account|acct|ref|reference|invoice|inv)[\s#.:]*\d{4,}\b/gi,
  },
  // Street addresses
  {
    type: 'address',
    regex:
      /\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Way|Court|Ct|Place|Pl)\.?\b/g,
  },
  // Canadian postal codes
  { type: 'address', regex: /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/g },
  // US zip codes (5 or 5+4)
  { type: 'address', regex: /\b\d{5}(?:-\d{4})?\b/g },
];

// --- Dictionary ---

export function loadDictionary(): Dictionary {
  try {
    return JSON.parse(fs.readFileSync(DICT_PATH, 'utf8'));
  } catch {
    return { people: [], companies: [], projects: [], locations: [] };
  }
}

export function saveDictionary(dict: Dictionary): void {
  ensureVaultDirs();
  fs.writeFileSync(DICT_PATH, JSON.stringify(dict, null, 2));
}

// --- Vault Storage ---

function ensureVaultDirs(): void {
  fs.mkdirSync(SCRUBBED_DIR, { recursive: true });
  fs.mkdirSync(MAPPINGS_DIR, { recursive: true });
}

export function loadVaultIndex(): VaultEntry[] {
  try {
    return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function saveVaultIndex(entries: VaultEntry[]): void {
  ensureVaultDirs();
  fs.writeFileSync(INDEX_PATH, JSON.stringify(entries, null, 2));
}

export function getVaultEntry(id: string): VaultEntry | undefined {
  return loadVaultIndex().find((e) => e.id === id);
}

export function readScrubbed(id: string): string | null {
  const entry = getVaultEntry(id);

  // Always check vault .txt first (works for both binary and text files)
  const txtPath = path.join(SCRUBBED_DIR, `${id}.txt`);
  try {
    return fs.readFileSync(txtPath, 'utf8');
  } catch {}

  // Fallback: for binary originals, check .md at the original path
  if (entry) {
    const ext = path.extname(entry.originalName).toLowerCase();
    if (ext === '.docx' || ext === '.pdf') {
      const mdPath = entry.originalPath.replace(/\.[^.]+$/, '.md');
      try {
        return fs.readFileSync(mdPath, 'utf8');
      } catch {}
    }
  }

  return null;
}

export function readMapping(id: string): Mapping | null {
  const p = path.join(MAPPINGS_DIR, `${id}.json`);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function updateVaultEntryStatus(
  id: string,
  status: VaultEntry['status'],
): boolean {
  const entries = loadVaultIndex();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return false;
  entry.status = status;
  saveVaultIndex(entries);
  return true;
}

export function deleteVaultEntry(id: string): boolean {
  const entries = loadVaultIndex();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;

  entries.splice(idx, 1);
  saveVaultIndex(entries);

  try {
    fs.unlinkSync(path.join(SCRUBBED_DIR, `${id}.txt`));
  } catch {}
  try {
    fs.unlinkSync(path.join(MAPPINGS_DIR, `${id}.json`));
  } catch {}
  return true;
}

// --- Core Scrub ---

export function scrubText(text: string, dict?: Dictionary): ScrubResult {
  const dictionary = dict || loadDictionary();
  const mapping: Mapping = {};
  const counter: Record<string, number> = {};
  let result = text;

  function getPlaceholder(type: string, original: string): string {
    for (const [ph, val] of Object.entries(mapping)) {
      if (val.toLowerCase() === original.toLowerCase()) return ph;
    }
    const prefix = PLACEHOLDER_PREFIXES[type] || type.toUpperCase();
    counter[type] = (counter[type] || 0) + 1;
    const ph = `[${prefix}_${counter[type]}]`;
    mapping[ph] = original;
    return ph;
  }

  // 1. Dictionary-based (known entities, longest first)
  for (const [type, entries] of Object.entries(dictionary)) {
    const singularType =
      type === 'companies'
        ? 'company'
        : type === 'people'
          ? 'person'
          : type.replace(/s$/, '');
    const sorted = [...entries].sort((a, b) => b.length - a.length);
    for (const entry of sorted) {
      const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
      result = result.replace(regex, (match) =>
        getPlaceholder(singularType, match),
      );
    }
  }

  // 2. Pattern-based
  for (const pattern of PATTERNS) {
    result = result.replace(pattern.regex, (match) =>
      getPlaceholder(pattern.type, match),
    );
  }

  // 3. Audit warnings
  const warnings = audit(result);

  return { scrubbed: result, mapping, warnings };
}

function audit(scrubbed: string): string[] {
  const warnings: string[] = [];

  const possibleNames =
    scrubbed.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || [];
  const safeWords = new Set([
    'Priority Coach',
    'Finance Analyst',
    'Project Manager',
    'Document Processor',
    'Strategic Integrator',
    'Chat Agent',
    'Cash Runway',
    'Monthly Burn',
    'On Track',
    'At Risk',
    'Granite',
    'Claude',
    'Qwen',
    'Warden',
    'New Folder',
    'Social Insurance',
    'Credit Card',
  ]);

  for (const phrase of possibleNames) {
    if (!safeWords.has(phrase) && !phrase.startsWith('[')) {
      warnings.push(`Possible unscrubbed name: "${phrase}"`);
    }
  }

  const dollarMatches = scrubbed.match(/\$\d/g) || [];
  if (dollarMatches.length > 0) {
    warnings.push('Possible unscrubbed dollar amount found');
  }

  return warnings;
}

// --- Ollama AI Pass ---

export async function scrubWithOllama(
  text: string,
  existingResult: ScrubResult,
): Promise<ScrubResult> {
  const prompt = `You are a PII detection assistant. The text below has been partially scrubbed — anything already in [BRACKETS] like [PERSON_1], [EMAIL_2], [DATE_1] etc. is ALREADY SAFE. Do NOT include bracketed placeholders in your output.

Find ONLY the remaining unredacted personal information. Look carefully for:
- Full names or partial names of real people (e.g. "John Smith", "Sarah", "Dr. Lee")
- City names, provinces, states, postal/zip codes, country names tied to a person
- Organization or company names that could identify someone
- Any other personally identifiable information NOT yet in brackets

Return ONLY a JSON array. Each element: {"original": "exact text from the document", "category": "person|location|company|date|account|other"}
If everything is already scrubbed, return [].

IMPORTANT: Do NOT return anything already in [BRACKETS]. Only return raw text that needs scrubbing.

Text:
${text}`;

  const ollama = getOllamaConfig();
  if (!ollama.url) {
    logger.warn('No OLLAMA_URL configured, skipping AI pass');
    existingResult.warnings.push('Ollama AI pass skipped: no URL configured');
    return existingResult;
  }

  logger.info({ url: ollama.url, model: ollama.model }, 'Calling Ollama for PII scrub');

  try {
    const resp = await fetch(`${ollama.url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollama.model,
        prompt,
        stream: false,
        keep_alive: -1,
        options: { temperature: 0, num_predict: 4096 },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      logger.warn(
        { status: resp.status, body: body.slice(0, 200) },
        'Ollama request failed, skipping AI pass',
      );
      existingResult.warnings.push(`Ollama AI pass failed: HTTP ${resp.status}`);
      return existingResult;
    }

    const data = (await resp.json()) as { response: string };
    let found: Array<{ original: string; category: string }>;

    try {
      // Extract JSON from the response (may be wrapped in markdown code blocks)
      const jsonMatch = data.response.match(/\[[\s\S]*?\]/);
      if (!jsonMatch) return existingResult;
      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) return existingResult;
      // Normalize: handle both [{original, category}] and plain string arrays
      found = parsed.map((item: any) => {
        if (typeof item === 'string')
          return { original: item, category: 'other' };
        return item;
      });
    } catch {
      logger.warn(
        'Failed to parse Ollama response as JSON, skipping AI findings',
      );
      return existingResult;
    }

    logger.info({ ollamaFindings: found.length, raw: data.response.slice(0, 500) }, 'Ollama AI pass response');

    // Apply additional scrubs from Ollama
    let scrubbed = existingResult.scrubbed;
    const mapping = { ...existingResult.mapping };
    const warnings = [...existingResult.warnings];

    // Count existing placeholders to continue numbering
    const counter: Record<string, number> = {};
    for (const ph of Object.keys(mapping)) {
      const match = ph.match(/\[([A-Z]+)_(\d+)\]/);
      if (match) {
        const type = match[1].toLowerCase();
        const num = parseInt(match[2], 10);
        counter[type] = Math.max(counter[type] || 0, num);
      }
    }

    for (const item of found) {
      if (!item.original || !item.category) continue;
      // Skip existing placeholders
      if (/^\[.+\]$/.test(item.original.trim())) continue;
      // Skip if not in text
      if (!scrubbed.includes(item.original)) continue;

      const type = item.category.toLowerCase();
      const prefix = PLACEHOLDER_PREFIXES[type] || type.toUpperCase();
      counter[type] = (counter[type] || 0) + 1;
      const ph = `[${prefix}_${counter[type]}]`;

      const escaped = item.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      scrubbed = scrubbed.replace(new RegExp(escaped, 'g'), ph);
      mapping[ph] = item.original;
    }

    // Remove warnings for items that Ollama caught
    return { scrubbed, mapping, warnings, ollamaUsed: true };
  } catch (err: any) {
    logger.warn({ err: err?.message || err }, 'Ollama AI pass failed, using regex-only results');
    existingResult.warnings.push(`Ollama AI pass failed: ${err?.message || 'connection error'}`);
    return existingResult;
  }
}

// --- Unscrub ---

export function unscrub(text: string, mapping: Mapping): string {
  let result = text;
  const placeholders = Object.keys(mapping).sort((a, b) => b.length - a.length);
  for (const ph of placeholders) {
    const escaped = ph.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'g'), mapping[ph]);
  }
  return result;
}

// --- Name Detection Post-Pass ---

const SAFE_PHRASES = new Set([
  // Common titles/roles
  'Priority Coach', 'Finance Analyst', 'Project Manager', 'Document Processor',
  'Strategic Integrator', 'Chat Agent', 'Cash Runway', 'Monthly Burn',
  'On Track', 'At Risk', 'New Folder', 'Social Insurance', 'Credit Card',
  'Lead Developer', 'Director Finance',
  // AI model names
  'Granite', 'Claude', 'Qwen', 'Warden',
  // Common tech/business terms that look like names
  'Next', 'Wire Transfer',
]);

// Words that commonly start capitalized phrases but aren't names
const SAFE_PREFIXES = new Set([
  'The', 'This', 'That', 'These', 'Those', 'Our', 'Your', 'My', 'His', 'Her',
  'Its', 'We', 'They', 'You', 'All', 'Any', 'Each', 'Every', 'Some', 'No',
  'Not', 'And', 'But', 'Or', 'For', 'Nor', 'Yet', 'So', 'If', 'As', 'Do',
]);

// Section headers and common document terms
const SAFE_PATTERNS = /^(?:Primary Contact|Billing Contact|Project Overview|Technical Requirements|Team Members|Budget|Timeline|Notes|Payment|Go-live|Beta|Kickoff|Design|Approved|Submitted|Suite|Delivery|Warehouse|Subscription|Custom|Integration|Content|Admin|Technical|Marketing)\b/;

function catchRemainingNames(result: ScrubResult): ScrubResult {
  const namePattern = /\b[A-Z][a-z]+(?:['\u2019]s)?(?:\s+[A-Z][a-z]+(?:['\u2019]s)?)+\b/g;
  let scrubbed = result.scrubbed;
  const mapping = { ...result.mapping };
  const warnings = [...result.warnings];

  // Count existing placeholders to continue numbering
  const counter: Record<string, number> = {};
  for (const ph of Object.keys(mapping)) {
    const m = ph.match(/\[([A-Z]+)_(\d+)\]/);
    if (m) {
      const type = m[1].toLowerCase();
      const num = parseInt(m[2], 10);
      counter[type] = Math.max(counter[type] || 0, num);
    }
  }

  const matches = scrubbed.match(namePattern) || [];
  // Deduplicate and sort longest first
  const unique = [...new Set(matches)].sort((a, b) => b.length - a.length);

  for (const phrase of unique) {
    // Skip if it's a known safe phrase
    if (SAFE_PHRASES.has(phrase)) continue;
    // Skip if starts with a safe prefix word
    const firstWord = phrase.split(/\s+/)[0];
    if (SAFE_PREFIXES.has(firstWord)) continue;
    // Skip section headers and common document terms
    if (SAFE_PATTERNS.test(phrase)) continue;
    // Skip anything already inside brackets
    if (phrase.startsWith('[')) continue;
    // Skip single-word matches (the regex requires 2+ words, but just in case)
    if (!phrase.includes(' ') && !phrase.includes("'")) continue;

    // Determine category: 2-3 word phrases with no common words = likely a person name
    const words = phrase.split(/\s+/);
    let category = 'person';
    // If 3+ words and contains common business words, might be a company
    if (words.length >= 3) {
      const businessWords = new Set(['Inc', 'Ltd', 'Corp', 'Trust', 'Bank', 'Group', 'Organics', 'Industries', 'Solutions', 'Technologies']);
      if (words.some(w => businessWords.has(w))) category = 'company';
    }

    const type = category;
    const prefix = PLACEHOLDER_PREFIXES[type] || type.toUpperCase();

    // Check if already mapped (case-insensitive)
    let existingPh: string | null = null;
    for (const [ph, val] of Object.entries(mapping)) {
      if (val.toLowerCase() === phrase.toLowerCase()) {
        existingPh = ph;
        break;
      }
    }

    const placeholder = existingPh || (() => {
      counter[type] = (counter[type] || 0) + 1;
      const ph = `[${prefix}_${counter[type]}]`;
      mapping[ph] = phrase;
      return ph;
    })();

    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    scrubbed = scrubbed.replace(new RegExp(`\\b${escaped}\\b`, 'g'), placeholder);
  }

  // Also catch single first names that match already-found full names
  // e.g. if "Sarah Chen" was caught, also catch standalone "Sarah"
  const personNames = Object.entries(mapping)
    .filter(([ph]) => ph.startsWith('[PERSON_'))
    .map(([ph, val]) => ({ ph, val }));

  for (const { ph, val } of personNames) {
    const firstName = val.split(/\s+/)[0];
    if (firstName.length < 3) continue; // Skip very short names
    // Check if standalone first name appears in text (not already in a placeholder)
    const fnRegex = new RegExp(`(?<!\\[)\\b${firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b(?!_\\d+\\])`, 'g');
    scrubbed = scrubbed.replace(fnRegex, ph);
  }

  // Remove warnings for items we caught
  const filteredWarnings = warnings.filter(w => {
    const m = w.match(/Possible unscrubbed name: "(.+)"/);
    if (!m) return true;
    return scrubbed.includes(m[1]);
  });

  return { scrubbed, mapping, warnings: filteredWarnings };
}

// --- Full Scrub Pipeline ---

async function extractText(filePath: string): Promise<{ text: string; isBinary: boolean }> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.docx') {
    const mammoth = await import('mammoth');
    const buf = fs.readFileSync(filePath);
    const result = await mammoth.default.extractRawText({ buffer: buf });
    return { text: result.value, isBinary: true };
  }

  if (ext === '.pdf') {
    try {
      const { execFileSync } = require('child_process');
      const text = execFileSync('pdftotext', [filePath, '-'], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
      return { text, isBinary: true };
    } catch (err) {
      logger.error({ err, filePath }, 'pdftotext failed');
      throw new Error(`Could not extract text from PDF: ${path.basename(filePath)}`);
    }
  }

  return { text: fs.readFileSync(filePath, 'utf8'), isBinary: false };
}

export interface ScrubFileResult {
  entry: VaultEntry;
  warnings: string[];
  ollamaUsed: boolean;
}

export async function scrubFile(
  filePath: string,
  useOllama: boolean = true,
): Promise<ScrubFileResult> {
  ensureVaultDirs();

  const { text, isBinary } = await extractText(filePath);
  let result = scrubText(text);

  if (useOllama) {
    result = await scrubWithOllama(result.scrubbed, result);
  }

  // Post-pass: catch any remaining capitalized multi-word phrases (likely names)
  result = catchRemainingNames(result);

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const originalName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  if (isBinary) {
    // Store original binary in vault, replace with scrubbed .md at original location
    fs.copyFileSync(filePath, path.join(SCRUBBED_DIR, `${id}${ext}`));
    // Also store scrubbed text in vault so it's always accessible
    fs.writeFileSync(path.join(SCRUBBED_DIR, `${id}.txt`), result.scrubbed);
    const mdPath = filePath.replace(/\.[^.]+$/, '.md');
    fs.writeFileSync(mdPath, result.scrubbed);
    fs.unlinkSync(filePath);
  } else {
    // Text file — store scrubbed copy in vault, replace original in place
    fs.writeFileSync(path.join(SCRUBBED_DIR, `${id}.txt`), result.scrubbed);
    fs.writeFileSync(filePath, result.scrubbed);
  }

  fs.writeFileSync(
    path.join(MAPPINGS_DIR, `${id}.json`),
    JSON.stringify(result.mapping, null, 2),
  );

  const entry: VaultEntry = {
    id,
    originalPath: filePath,
    originalName,
    scrubDate: new Date().toISOString(),
    status: 'scrubbed',
  };

  const index = loadVaultIndex();
  index.push(entry);
  saveVaultIndex(index);

  return {
    entry,
    warnings: result.warnings,
    ollamaUsed: result.ollamaUsed === true,
  };
}

export { VAULT_DIR, SCRUBBED_DIR, MAPPINGS_DIR, DICT_PATH };
