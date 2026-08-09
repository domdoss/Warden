---
name: deliverables
description: "Where to put files the user will want to download — finished reports, generated docs, images, PDFs, data exports. Write deliverables to groups/uploads/ so they appear in the hologram Upload panel's Downloads half. Use whenever you produce a finished file for the user, not a transient working file."
tools: ["Write", "Bash", "Read"]
when_to_use: The user asks for a file they'll want to keep or download — a report, a generated document, an image, a PDF, an export. Phrases like "write me a report on X", "generate a PDF", "make a doc", "put it in my downloads", "export this", "save this as a file".
example_prompt: Write me a short markdown report on last week's calendar and put it in my downloads.
---

# Deliverables — where to put files the user downloads

When you produce a **finished deliverable** for the user, write it to the shared
downloads folder so it shows up in the hologram Upload panel's **Downloads**
half, where the user can click to download it.

## The path

Write to:

```
groups/uploads/<filename>
```

This is a path **relative to your workspace root** (your `cwd` IS the workspace
root — `~/warden` / `/workspace` — you do not chdir into a group folder). So
`groups/uploads/` is the literal relative path you pass to your file
tools. It resolves to `~/warden/groups/uploads/` on disk, which is the
folder the Downloads panel lists live.

## How to write

- **Text deliverables** (markdown, txt, csv, json, code): use `Write` with
  `file_path="groups/uploads/<name>"`. The directory is created
  automatically if missing.
- **Binary deliverables** (PDF, PNG/JPG, xlsx, anything not text): `Write`
  only writes text, so use `Bash` to produce the bytes at that path (e.g.
  render with a tool and redirect output, or write a script that emits the
  file). Example: `Bash("render-report.py > groups/uploads/report.pdf")`
  or copy a file you generated: `Bash("cp /tmp/out.pdf groups/uploads/")`.

## Naming

Give files clear, human-readable, dated names. The user sees these in a list:

- ✅ `weekly-review-2026-08-09.md`
- ✅ `med-recap-2026-08-09.pdf`
- ❌ `output.txt`, `file (2).md`, `tmp.md`

## After writing

Tell the user the filename and that it's in their Downloads panel. Do not
paste the whole file contents as well unless they ask — the file is the
deliverable.

## Deliverables vs. attach_file

These are two different things:

- `groups/uploads/` → the **Downloads panel** in the hologram UI. Use
  this for finished files the user will download and keep.
- `attach_file` → an **inline attachment on the chat message**. Use this when
  you want the file shown in the conversation itself.

You can do both: write the file to `groups/uploads/` for the Downloads
panel, and also `attach_file` it if it should appear inline in chat.

## Do NOT put here

- Transient / scratch / working files — write those to your normal workspace.
- Files the user never asked for and won't want to keep.
- Duplicates of files that already exist there (overwrite by the same name is
  fine, but don't litter the folder with `report-v2.md`, `report-v3.md`).

This folder is for finished deliverables only.