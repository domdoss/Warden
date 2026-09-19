---
name: backup-archive
description: "Back up, archive, restore, and sync files and directories — tar/zip archives with compression and encryption, rsync mirrors with dry-run verification, checksums, snapshot listings, scheduled backup patterns. Use for any 'back this up / archive / restore / sync' task."
---

## Archive (tar)
- Create, compressed: `tar -czf backup-$(date +%F).tar.gz -C /path/to/parent dirname` (`-C` stores the dir name, not the whole path).
- Exclude noise: add `--exclude='*.log' --exclude='node_modules' --exclude='.cache'` per pattern.
- List contents before/after: `tar -tzf backup.tar.gz | head` — always verify an archive by LISTING it, never assume.
- Extract: `tar -xzf backup.tar.gz -C /target/dir` (list first to see where it lands).
- Uncompressed directory snapshot: `tar -cf - -C /src . | tar -xf - -C /dst` (copies trees verbatim through a pipe).

## zip
- `zip -r out.zip dir/` (add `-e` for password-encrypted, `-9` max compression). List: `unzip -l out.zip`.

## rsync (sync / mirror / incremental backup)
- Mirror with verification: `rsync -avh --progress --delete /src/ /dst/` — TRAILING SLASH on src means "contents of", no slash means "the dir itself". `--delete` makes dst an exact mirror (destructive — run without it first when unsure).
- Dry run first: add `-n` and READ the output (what would transfer/delete) before running for real.
- Over the network: `rsync -avz -e ssh /src/ user@host:/dst/`.
- Resumable/verify existing: `-c` forces checksum comparison when timestamps are unreliable.

## Integrity
- Checksums: `sha256sum backup.tar.gz > backup.tar.gz.sha256`; verify: `sha256sum -c backup.tar.gz.sha256`.
- Verify a backup is REAL by restoring it somewhere scratch and diffing: `tar -xzf backup.tar.gz -C /tmp/restore-test && diff -r /tmp/restore-test/dir /src/dir`.

## Rules
- Destination defaults to a path under `/home/dominic/Warden/` (documents) unless the task names one — external drives and network targets only when stated.
- Report the archive path + size (`ls -lh`) and the verified file count in the reply.
- A backup that was never listed/verified is a file that MIGHT be a backup — verify, then report.