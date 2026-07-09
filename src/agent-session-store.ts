import Database from 'better-sqlite3';

export interface AgentSession {
    id: string;
    jid: string;
    model: string | null;
    title: string | null;
    parent_session_id: string | null;
    system_prompt: string | null;
    started_at: string;
    ended_at: string | null;
    end_reason: string | null;
    message_count: number;
    tool_call_count: number;
    compression_count: number;
}

export interface AgentMessage {
    id?: number;
    session_id: string;
    role: string;
    content: string | null;
    tool_calls: string | null;
    tool_call_id: string | null;
    tool_name: string | null;
    tool_result: string | null;
    timestamp: string;
    token_count: number;
}

export interface AgentSearchResult {
    session_id: string;
    role: string;
    content: string;
    tool_name: string;
    tool_result: string;
    rank: number;
}

export class AgentSessionStore {
    private db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
        this.initTables();
    }

    private initTables(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS agent_sessions (
                id TEXT PRIMARY KEY,
                jid TEXT NOT NULL,
                model TEXT,
                title TEXT,
                parent_session_id TEXT REFERENCES agent_sessions(id),
                system_prompt TEXT,
                started_at TEXT DEFAULT (datetime('now')),
                ended_at TEXT,
                end_reason TEXT,
                message_count INTEGER DEFAULT 0,
                tool_call_count INTEGER DEFAULT 0,
                compression_count INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS agent_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES agent_sessions(id),
                role TEXT NOT NULL,
                content TEXT,
                tool_calls TEXT,
                tool_call_id TEXT,
                tool_name TEXT,
                tool_result TEXT,
                timestamp TEXT DEFAULT (datetime('now')),
                token_count INTEGER DEFAULT 0
            );

            -- Full-text search across agent conversation content
            CREATE VIRTUAL TABLE IF NOT EXISTS agent_messages_fts USING fts5(
                role, content, tool_name, tool_result,
                content='agent_messages', content_rowid='id'
            );

            CREATE TRIGGER IF NOT EXISTS agent_msgs_ai AFTER INSERT ON agent_messages BEGIN
                INSERT INTO agent_messages_fts(rowid, role, content, tool_name, tool_result)
                VALUES (new.id, new.role, new.content, new.tool_name, new.tool_result);
            END;

            CREATE TRIGGER IF NOT EXISTS agent_msgs_ad AFTER DELETE ON agent_messages BEGIN
                INSERT INTO agent_messages_fts(agent_messages_fts, rowid, role, content, tool_name, tool_result)
                VALUES ('delete', old.id, old.role, old.content, old.tool_name, old.tool_result);
            END;

            CREATE INDEX IF NOT EXISTS idx_agent_msgs_session ON agent_messages(session_id, timestamp);
            CREATE INDEX IF NOT EXISTS idx_agent_sessions_jid ON agent_sessions(jid, started_at);
        `);
    }

    createSession(jid: string, model?: string, parentSessionId?: string): string {
        const id = `as_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this.db.prepare(`
            INSERT INTO agent_sessions (id, jid, model, parent_session_id)
            VALUES (?, ?, ?, ?)
        `).run(id, jid, model || null, parentSessionId || null);
        return id;
    }

    endSession(sessionId: string, endReason: string): void {
        this.db.prepare(`
            UPDATE agent_sessions SET ended_at = datetime('now'), end_reason = ?
            WHERE id = ?
        `).run(endReason, sessionId);
    }

    addMessage(sessionId: string, msg: AgentMessage): number {
        const result = this.db.prepare(`
            INSERT INTO agent_messages (session_id, role, content, tool_calls, tool_call_id, tool_name, tool_result, token_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            sessionId, msg.role, msg.content || null, msg.tool_calls || null,
            msg.tool_call_id || null, msg.tool_name || null, msg.tool_result || null,
            msg.token_count || 0
        );
        // Bump the message counter
        this.db.prepare(`
            UPDATE agent_sessions SET message_count = message_count + 1 WHERE id = ?
        `).run(sessionId);
        return Number(result.lastInsertRowid);
    }

    getMessages(sessionId: string, limit = 100, offset = 0): AgentMessage[] {
        return this.db.prepare(`
            SELECT * FROM agent_messages
            WHERE session_id = ?
            ORDER BY id ASC
            LIMIT ? OFFSET ?
        `).all(sessionId, limit, offset) as AgentMessage[];
    }

    getSession(sessionId: string): AgentSession | null {
        const row = this.db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(sessionId);
        return (row as AgentSession) || null;
    }

    listSessions(jid: string, limit = 20, offset = 0): AgentSession[] {
        return this.db.prepare(`
            SELECT * FROM agent_sessions
            WHERE jid = ?
            ORDER BY started_at DESC
            LIMIT ? OFFSET ?
        `).all(jid, limit, offset) as AgentSession[];
    }

    deleteOldSessions(jid: string, olderThanDays: number): number {
        const result = this.db.prepare(`
            DELETE FROM agent_sessions
            WHERE jid = ? AND started_at < datetime('now', '-' || ? || ' days')
        `).run(jid, String(olderThanDays));
        return result.changes;
    }

    searchMessages(jid: string, query: string, limit = 20): AgentSearchResult[] {
        return this.db.prepare(`
            SELECT am.session_id, am.role, am.content, am.tool_name, am.tool_result, rank
            FROM agent_messages_fts fts
            JOIN agent_messages am ON am.id = fts.rowid
            JOIN agent_sessions s ON s.id = am.session_id
            WHERE s.jid = ? AND agent_messages_fts MATCH ?
            ORDER BY rank
            LIMIT ?
        `).all(jid, query, limit) as AgentSearchResult[];
    }

    searchAllSessions(query: string, limit = 20): AgentSearchResult[] {
        return this.db.prepare(`
            SELECT am.session_id, am.role, am.content, am.tool_name, am.tool_result, rank
            FROM agent_messages_fts fts
            JOIN agent_messages am ON am.id = fts.rowid
            WHERE agent_messages_fts MATCH ?
            ORDER BY rank
            LIMIT ?
        `).all(query, limit) as AgentSearchResult[];
    }

    /** End current session and create a child for compressed continuation */
    splitSession(oldSessionId: string, endReason: string): string {
        const old = this.getSession(oldSessionId);
        if (!old) throw new Error(`Session ${oldSessionId} not found`);
        this.endSession(oldSessionId, endReason);
        return this.createSession(old.jid, old.model || undefined, oldSessionId);
    }
}
