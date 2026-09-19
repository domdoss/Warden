---
name: systemd-services
description: "Manage systemd units on this host — status, restart, logs of warden.service and any other service, timers, enable/disable, failed-unit triage. Use whenever a task says a service is down, misbehaving, needs restarting, or logs need reading."
---

## Warden's own service
- Warden runs as a **user** service: `systemctl --user {is-active,status,restart} warden.service`. User units need `XDG_RUNTIME_DIR=/run/user/$(id -u)` in the environment — from a shell it is usually already set; from scripts add it.
- Logs live in `/opt/Warden/logs/warden.log` and `warden.error.log` — prefer the file logs for warden; also `journalctl --user -u warden.service` works.
- After a restart confirm health: `systemctl --user is-active warden.service` and `curl -s http://localhost:3200/` returns 200.

## General units
- Status: `systemctl status <unit>` (user units: `systemctl --user status <unit>`). State only: `systemctl is-active <unit>`.
- Restart / start / stop: `systemctl restart <unit>` (add `--user` where the unit is a user unit).
- Logs: `journalctl -u <unit> -n 100` for the tail; `-f` to follow while diagnosing; `--user -u` for user units. Time-bounded: `journalctl -u <unit> --since "1 hour ago"`.
- Enable/disable at boot: `systemctl enable|disable <unit>` (add `--now` to also start/stop immediately).
- List failures: `systemctl --failed` (plus `--user --failed`) — triage any unit shown there with `status` + `journalctl`.
- Timers: `systemctl list-timers` shows next fire; `journalctl -u <timer-unit>` shows past runs.
- Reload after editing a unit file: `systemctl daemon-reload` (or `--user daemon-reload`), then restart the unit.

## Rules
- Read status/logs FIRST, restart SECOND — name the cause in the reply, and the restart as the action taken.
- Never use `sudo` for user units; system units may need it.
- Report the actual `is-active` result after acting — confirm, never assume.