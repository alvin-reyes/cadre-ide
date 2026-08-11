/**
 * Minimal stdio MCP server used only as a test fixture for `client.test.ts`:
 * exposes exactly two no-op tools, `echo` and `ping`, and nothing else. Run
 * compiled as `node dist-cli/cli/mcp/stubServer.js` (tsconfig.cli.json's
 * `rootDir: "src"` mirrors `src/cli/mcp/*` under `dist-cli/cli/mcp/*`, same as
 * every other `src/cli/*` entry) — `probeConnection` spawns it exactly like it
 * would spawn a real user-configured stdio server.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "cadre-mcp-stub", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "echo", description: "Echoes input back (stub, no-op).", inputSchema: { type: "object", properties: {} } },
    { name: "ping", description: "Replies pong (stub, no-op).", inputSchema: { type: "object", properties: {} } },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async () => ({
  content: [{ type: "text", text: "ok" }],
}));

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
