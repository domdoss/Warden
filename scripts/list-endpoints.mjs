// Scans src/status-server.ts and prints every API route path.
// (Methods vary per route — see API.md for the full method + params reference.)
// Usage: node scripts/list-routes.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'status-server.ts'), 'utf8');

const paths = new Set();
for (const m of src.matchAll(/'(\/api\/[a-zA-Z0-9/_.-]*)'/g)) {
  paths.add(m[1].replace(/\\\//g, '/'));
}

const sorted = [...paths].sort();
console.log(sorted.join('\n'));
console.log(sorted.length + " endpoints");
