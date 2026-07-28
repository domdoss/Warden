---
name: warden-db
description: "Inspect and query the SQLite databases under /home/user/warden/data/ (warden.db, store.db, warden.db, messages.db, dashboard.db, router_state.db, nanoclaw.db, mirific.db, db.sqlite, db.sqlite3). List tables, schema, row counts, and run safe read-only SELECTs. Use when the user asks what's in a Warden DB, wants to inspect messages/tasks/state, or needs a row count."
tools: ["Bash","Read"]
---

# warden-db — Warden SQLite inspector skill

The Warden data directory `/home/user/warden/data/` holds many SQLite shards.
This skill gives safe, read-only access to them.

## Known DBs (paths relative to /home/user/warden)
| File | Likely contents |
|------|-----------------|
| `data/warden.db`    | core orchestrator state (often 0-byte on fresh installs) |
| `data/store.db`      | generic key/value store |
| `data/warden.db`     | agent / conversation state |
| `data/messages.db`   | inbound/outbound channel messages |
| `data/dashboard.db`  | dashboard widgets / metrics |
| `data/router_state.db` | message-router state |
| `data/nanoclaw.db`   | nanoclaw subsystem |
| `data/mirific.db`    | mirific bot (Telegram) state |
| `data/db.sqlite` / `data/db.sqlite3` | legacy/shard (often 0-byte) |

## Commands (always read-only)

**List all DBs with sizes & table counts:**
```
for db in /home/user/warden/data/*.db /home/user/warden/data/*.sqlite*; do
  [ -f "$db" ] || continue
  sz=$(stat -c%s "$db")
  tbl=$(sqlite3 "$db" "SELECT count(*) FROM sqlite_master WHERE type='table';" 2>/dev/null)
  echo "$(basename $db)  size=${sz}B  tables=${tbl}"
done
```

**Schema of one DB:**
`sqlite3 /home/user/warden/data/<name>.db ".schema" | head -80`

**Row counts for every table in a DB:**
```
for t in $(sqlite3 /home/user/warden/data/<name>.db "SELECT name FROM sqlite_master WHERE type='table';"); do
  c=$(sqlite3 /home/user/warden/data/<name>.db "SELECT count(*) FROM \"$t\";")
  echo "$t: $c"
done
```

**Sample rows (safe):**
`sqlite3 -header -column /home/user/warden/data/<name>.db "SELECT * FROM <table> LIMIT 10;"`

## Rules
- READ-ONLY. Never run `INSERT`/`UPDATE`/`DELETE`/`DROP`/`ALTER` against these DBs unless the user explicitly asks and confirms the exact statement twice.
- Never `VACUUM` or `REINDEX` — they lock the DB and can stall the live orchestrator.
- If a DB is 0 bytes, report it as "empty (uninitialized shard)" — not an error.
- If `sqlite3` reports "database is locked", retry once after 1s; if still locked, tell the user the orchestrator holds it and offer to query via the orchestrator's own tooling instead.
- Use `sqlite3` (already installed at /usr/bin/sqlite3). Do not install new packages.
- Redact obvious PII (tokens, password hashes, emails) in your summary unless the user asks to see them.
