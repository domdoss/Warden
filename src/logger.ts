import pino from 'pino';
import path from 'node:path';

// Two destinations:
//   1. stdout (pino-pretty, colorized) → captured by systemd into journald
//      (`journalctl --user -u warden.service`). The live, primary log.
//   2. /opt/Warden/logs/warden.log (pino-pretty, plain text) → a readable file
//      so agents (whose Bash lacks XDG_RUNTIME_DIR and so can't run
//      `journalctl --user`) and humans can `tail -f` / Read it. Capped at
//      ~5 MB by startLogCap in index.ts. Plain text (no ANSI) on purpose —
//      a file full of escape codes is unreadable to tools that Read it.
const level = process.env.LOG_LEVEL || 'info';
const logFile = path.resolve(process.cwd(), 'logs', 'warden.log');

export const logger = pino({
  level,
  transport: {
    targets: [
      { target: 'pino-pretty', level, options: { colorize: true } },
      { target: 'pino-pretty', level, options: { colorize: false, destination: logFile, mkdir: true } },
    ],
  },
});

// Route uncaught errors through pino so they get timestamps in stderr
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
});