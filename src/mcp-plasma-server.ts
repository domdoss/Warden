#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  clipboardRead,
  clipboardWrite,
  currentActivity,
  isPlasma,
  kwinWindows,
  notify,
  openUrl,
} from './desktop-plasma.js';

const server = new McpServer({
  name: 'dockbox-plasma',
  version: '0.1.0',
});

const ok = (text: string) => ({
  content: [{ type: 'text' as const, text }],
});

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

server.registerTool(
  'plasma_notify',
  {
    description:
      'Show a desktop notification via org.freedesktop.Notifications. Use for asynchronous status updates the user should see without a window switch.',
    inputSchema: {
      title: z.string().min(1).max(200),
      body: z.string().max(2000).default(''),
      urgency: z.enum(['low', 'normal', 'critical']).default('normal'),
    },
  },
  async ({ title, body, urgency }) => {
    try {
      await notify(title, body, urgency);
      return ok('notified');
    } catch (e) {
      return { content: [{ type: 'text', text: 'notify failed: ' + errText(e) }], isError: true };
    }
  },
);

server.registerTool(
  'plasma_open_url',
  {
    description:
      "Open a URL or local file with the user's default handler (xdg-open). Only http/https/file schemes are allowed.",
    inputSchema: {
      url: z.string().url(),
    },
  },
  async ({ url }) => {
    try {
      await openUrl(url);
      return ok('opened ' + url);
    } catch (e) {
      return { content: [{ type: 'text', text: 'open failed: ' + errText(e) }], isError: true };
    }
  },
);

server.registerTool(
  'plasma_clipboard_read',
  {
    description: 'Return the current clipboard text contents via Klipper.',
    inputSchema: {},
  },
  async () => {
    try {
      const text = await clipboardRead();
      return ok(text);
    } catch (e) {
      return { content: [{ type: 'text', text: 'read failed: ' + errText(e) }], isError: true };
    }
  },
);

server.registerTool(
  'plasma_clipboard_write',
  {
    description: 'Replace the clipboard contents with the given text via Klipper.',
    inputSchema: {
      text: z.string(),
    },
  },
  async ({ text }) => {
    try {
      await clipboardWrite(text);
      return ok('clipboard updated');
    } catch (e) {
      return { content: [{ type: 'text', text: 'write failed: ' + errText(e) }], isError: true };
    }
  },
);

server.registerTool(
  'plasma_current_activity',
  {
    description: 'Return the UUID of the currently active KDE Activity.',
    inputSchema: {},
  },
  async () => {
    try {
      const id = await currentActivity();
      return ok(id);
    } catch (e) {
      return { content: [{ type: 'text', text: 'query failed: ' + errText(e) }], isError: true };
    }
  },
);

server.registerTool(
  'plasma_kwin_windows',
  {
    description:
      'List KWin-managed windows as JSON [{uuid, caption, resourceClass, desktop}]. Uses a one-shot KWin script + journalctl round-trip since KWin has no direct D-Bus enumeration API — may return an empty list if journalctl access is unavailable.',
    inputSchema: {},
  },
  async () => {
    try {
      const wins = await kwinWindows();
      return ok(JSON.stringify(wins, null, 2));
    } catch (e) {
      return { content: [{ type: 'text', text: 'list failed: ' + errText(e) }], isError: true };
    }
  },
);

async function main(): Promise<void> {
  if (!isPlasma()) {
    process.stderr.write(
      'dockbox-plasma: warning — KDE Plasma not detected (XDG_CURRENT_DESKTOP=' +
        (process.env.XDG_CURRENT_DESKTOP ?? '') +
        '). Tools will still register but qdbus calls will fail.\n',
    );
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  process.stderr.write('dockbox-plasma: fatal — ' + errText(e) + '\n');
  process.exit(1);
});
