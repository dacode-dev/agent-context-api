#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp-core.js";

export { createMcpServer } from "./mcp-core.js";

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("agent-context-api MCP server running on stdio");
}
