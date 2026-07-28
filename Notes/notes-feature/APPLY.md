# Notes tab — Obsidian-inspired

A native **Notes** tab for the dashboard: markdown notes with `[[wiki-links]]`,
backlinks, tags, search, daily notes. No Obsidian app interop, no new npm deps.
Storage is SQLite; the `[[link]]` graph + tags are derived from each note's body on
write. See `../dockbox/NOTES_PLAN.md` for the full design.

## What changes

**Modified (5):**
- `src/db.ts` — `notes` / `note_links` / `note_tags` schema (auto-created via
  `CREATE TABLE IF NOT EXISTS` on next server start, no manual migration) +
  CRUD + link/tag reindex + backlinks/tags/folders queries.
- `src/status-server.ts` — imports the notes functions; adds a `/api/notes/*`
  route block (list, get, create, update, delete, move, backlinks, tags, folders).
- `public/index.html` — Notes rail button (Org group), `#view-notes` section,
  `<script src="/js/notes.js">`.
- `public/js/app.js` — one refresh hook in `switchView` for the notes tab.
- `public/css/style.css` — appended `/* ===== Notes view ===== */` block.

**New (1):**
- `public/js/notes.js` — the tab (plain JS IIFE, no deps, no bundler).

## Apply

From the repo root (clean working tree on `main`):

```sh
git apply notes.patch
```

If you'd rather inspect first:

```sh
git apply --check notes.patch    # dry-run, no writes
git apply notes.patch
```

Then restart the server so the schema runs and the new routes load.

## Verify after applying

```sh
node --check public/js/notes.js              # frontend syntax
npx tsc --noEmit --skipLibCheck               # backend types
```

Both should pass (verified against a clean HEAD checkout: `tsc` exit 0,
`node --check` OK, `git apply --check` clean).

## API surface added

```
GET    /api/notes?folder=&tag=&q=      → { notes: [...] }
GET    /api/notes/:id                  → { note }
POST   /api/notes                      → { ok, note }            (body: {title, body?, folder?})
PUT    /api/notes/:id                  → { ok, note }            (body: {title?, body?, folder?})
DELETE /api/notes/:id                  → { ok }
POST   /api/notes/:id/move             → { ok, note }            (body: {folder})
GET    /api/notes/:id/backlinks         → { backlinks: [...] }
GET    /api/notes/tags                  → { tags: [{tag, count}] }
GET    /api/notes/folders              → { folders: [{folder, count}] }
```

## Notes / gotchas

- `uid` is a stable slug derived from the title; `[[Title]]` resolves
  case-insensitively to it. Renames that change the slug move the note to a new
  uid (disambiguated); renames that don't change the slug keep links intact.
- Unresolved `[[links]]` render muted; clicking offers to create the note.
- Single-writer (the dashboard) — no on-disk vault, no conflict handling, no
  `chokidar`. Backlinks/tags refresh on save.
- The optional **graph view** (Phase 3 in `NOTES_PLAN.md`) is not included.
- Agent `notes_*` tools are not included (dashboard-only for now).