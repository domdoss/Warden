---
name: arch-packages
description: "Package management on this Arch Linux host — pacman search/install/update/remove, AUR builds, orphan cleanup, foreign-package listing, pacman key/mirror issues. Use for any install/upgrade/remove package task or 'what provides X' question."
---

## pacman
- Search: `pacman -Ss <name>` (repos), `pacman -Qs <name>` (installed). One-liner info: `pacman -Si <pkg>` (repo) / `pacman -Qi <pkg>` (installed).
- Install: `pacman -S <pkg>` (needs sudo). Remove: `pacman -R <pkg>` (add `-s` to drop now-unneeded deps, `-n` to clear config).
- Full system upgrade: `pacman -Syu` — Arch is rolling; partial upgrades (`-Sy` without `-u`) break things, always the full `-Syu`.
- What owns a file: `pacman -Qo /path/to/file`. What files a package owns: `pacman -Ql <pkg>`.
- Foreign (AUR/manual) packages: `pacman -Qm`. Orphans: `pacman -Qtd` (remove with `pacman -Rns $(pacman -Qtdq)` when cleaning).

## AUR
- A helper handles deps + build: `paru -S <pkg>` or `yay -S <pkg>`. Check which is installed (`command -v paru yay`) before using one.
- Search AUR: `paru -Ss <name>`. Upgrades including AUR: `paru -Syu`.
- No helper → a manual build is `git clone https://aur.archlinux.org/<pkg>.git`, then `makepkg -si` inside the clone.

## Troubleshooting
- Keyring signature errors: `archlinux-keyring` is stale — `pacman -Sy archlinux-keyring && pacman -Syu`.
- "file exists in filesystem" conflicts on upgrade: list the owning package with `pacman -Qo`, decide keep/overwrite (`pacman -S --overwrite <glob>` only for known-safe paths).
- Lockfile after a crashed pacman: remove `/var/lib/pacman/db.lck` only after confirming no pacman is running (`pgrep pacman`).

## Rules
- Quote the exact command you ran and its exit state in the reply.
- A package name found in a search is a candidate — confirm it exists in `pacman -Si`/`paru` output before claiming it installed.
- Prefer repo packages over AUR when both exist (repo gets updates with `-Syu`).