import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../mcp-server.js";

test("MCP server exposes local preflight and paid upgrade boundary", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name), ["preflight_context"]);

  const free = await client.callTool({ name: "preflight_context", arguments: { text: "const key = 'sk-test-123456';" } });
  assert.equal(free.isError, undefined);
  assert.match(free.content[0].text, /redacted_count/);

  const paid = await client.callTool({ name: "preflight_context", arguments: { text: "x".repeat(12_001) } });
  assert.equal(paid.isError, true);
  assert.match(paid.content[0].text, /local_free_limit_exceeded/);

  await client.close();
  await server.close();
});
