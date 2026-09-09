/**
 * MARM → memory-map exporter.
 *
 * Serves the /nodes and /edges JSON the memory-map.html constellation
 * expects (see feedGraph() in the map — tolerant field picking), derived
 * from MARM's concept-graph SQLite (~/.marm/index/marm_index.db).
 *
 * - GET /nodes  → entities: [{ id, name, type, mention_count }]
 * - GET /edges  → relationships grouped into undirected pairs with a weight
 * - GET /health → { ok, entities, relationships }
 *
 * Read-only WAL connection; if the concept DB doesn't exist yet (MARM never
 * ran / concept graph never built) we serve an empty 200 — the map then falls
 * back to its built-in demo graph ("feed has no nodes").
 *
 * Port 8002: MARM's own HTTP server owns 8001.
 * Run: node /opt/Warden/marm-map-exporter.mjs
 */
import Database from 'better-sqlite3';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.MARM_MAP_PORT || 8002);
const DB_PATH = process.env.MARM_CONCEPT_DB_PATH || join(homedir(), '.marm', 'index', 'marm_index.db');

function readConceptGraph() {
  if (!existsSync(DB_PATH)) return { nodes: [], edges: [] };
  // Immutable + WAL-safe: a snapshot read that never blocks MARM's writers.
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const entities = db
      .prepare(
        `SELECT id, name, type, source_memory_ids
         FROM entities`,
      )
      .all();
    // One mention per memory provenance entry — a decent proxy for salience.
    const nodes = entities.map((e) => {
      let mentions = 0;
      try {
        const arr = JSON.parse(e.source_memory_ids || '[]');
        if (Array.isArray(arr)) mentions = arr.length;
      } catch {
        /* keep 0 */
      }
      return { id: e.id, name: e.name, type: e.type, mention_count: mentions };
    });

    const idSet = new Set(nodes.map((n) => n.id));
    const rows = db
      .prepare(
        `SELECT source_id, target_id, COUNT(*) AS n
         FROM relationships
         GROUP BY source_id, target_id`,
      )
      .all();
    // Undirected pair merge + 0.05..1 weight (map clamps anyway).
    const pair = new Map();
    for (const r of rows) {
      if (!idSet.has(r.source_id) || !idSet.has(r.target_id)) continue;
      const key = r.source_id < r.target_id ? `${r.source_id}-${r.target_id}` : `${r.target_id}-${r.source_id}`;
      pair.set(key, (pair.get(key) || 0) + r.n);
    }
    const edges = [...pair.entries()].map(([key, n]) => {
      const [source, target] = key.split('-').map(Number);
      return { source, target, weight: Math.min(1, 0.25 + 0.15 * n) };
    });
    return { nodes, edges };
  } finally {
    db.close();
  }
}

const server = http.createServer((req, res) => {
  const send = (code, body) => {
    res.writeHead(code, {
      'Content-Type': 'application/json',
      // The map loads from file:// (origin "null") — allow it.
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(body));
  };
  const url = (req.url || '').split('?')[0];
  try {
    const { nodes, edges } = readConceptGraph();
    if (url === '/nodes') return send(200, nodes);
    if (url === '/edges') return send(200, edges);
    if (url === '/health') return send(200, { ok: true, entities: nodes.length, relationships: edges.length, db: DB_PATH });
    return send(404, { error: 'not found' });
  } catch (err) {
    return send(500, { error: String(err) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`marm-map-exporter on http://127.0.0.1:${PORT} (db: ${DB_PATH})`);
});