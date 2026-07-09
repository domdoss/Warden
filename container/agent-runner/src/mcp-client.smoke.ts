/**
 * Smoke test for ExternalMcpClient — connects to `npx -y @playwright/mcp`,
 * lists tools, prints them, and disconnects. Run with:
 *   node dist/mcp-client.smoke.js
 *
 * Not part of the agent-runner's runtime; excluded from production imports.
 */
import { ExternalMcpClient, type McpServerConfig } from './mcp-client.js';

async function main(): Promise<void> {
  const config: McpServerConfig = {
    name: 'playwright',
    command: 'npx',
    args: ['-y', '@playwright/mcp'],
    transport: 'stdio',
    enabled: true,
  };

  const client = new ExternalMcpClient(config);
  console.log(`[smoke] connecting to ${config.command} ${config.args.join(' ')} ...`);
  const start = Date.now();
  await client.connect();
  console.log(`[smoke] connected in ${Date.now() - start}ms`);

  const tools = await client.listTools();
  console.log(`[smoke] server exposed ${tools.length} tool(s):`);
  for (const t of tools.slice(0, 10)) {
    console.log(`  - ${t.name}: ${(t.description ?? '').slice(0, 80)}`);
  }
  if (tools.length > 10) console.log(`  ... and ${tools.length - 10} more`);

  await client.disconnect();
  console.log('[smoke] disconnected');
}

main().catch((err) => {
  console.error('[smoke] FAILED:', err);
  process.exit(1);
});