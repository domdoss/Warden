import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

// MARM concept graph — the entity/relationship network the concept_worker
// extracts from memory CONTENT (i.e. what Warden learned from conversation),
// as opposed to the code graph (codebase-memory-mcp, which indexes SOURCE
// files) or the taxonomy tree (memory-tree.json). The galaxy renders this as
// its outer "knowledge halo" of topic stars and similarity links.

export interface ConceptEntity {
  id: number;
  name: string;
  type: string;
}

export interface ConceptRelationship {
  source_id: number;
  target_id: number;
  predicate: string;
}

export interface ConceptGraph {
  entities: ConceptEntity[];
  relationships: ConceptRelationship[];
}

/** Read the concept graph read-only. The DB is written by the marm
 *  concept_worker (agent-runner subprocess) in WAL mode, so a concurrent
 *  read-only open is safe. Returns empty lists when the DB is absent, empty or
 *  unreadable — the galaxy then renders the taxonomy tree alone. */
export function loadConceptGraph(): ConceptGraph {
  const dbPath = process.env.MARM_CONCEPT_DB_PATH ||
    path.join(os.homedir(), '.marm', 'index', 'marm_index.db');
  if (!fs.existsSync(dbPath)) return { entities: [], relationships: [] };
  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    return { entities: [], relationships: [] };
  }
  try {
    const entities = db.prepare(
      'SELECT id, name, type FROM entities ORDER BY id'
    ).all() as ConceptEntity[];
    const relationships = db.prepare(
      'SELECT source_id, target_id, predicate FROM relationships ORDER BY id'
    ).all() as ConceptRelationship[];
    return { entities, relationships };
  } catch {
    return { entities: [], relationships: [] };
  } finally {
    db.close();
  }
}
