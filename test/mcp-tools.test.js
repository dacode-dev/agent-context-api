import assert from "node:assert/strict";
import test from "node:test";
import { createMcpServer } from "../mcp-core.js";

// Minimal in-memory client that lists tools and calls one through the
// official SDK's InMemoryTransport, so the registration shape is verified
// exactly as real MCP clients see it.
test("mcp server exposes preflight_context and read_page_preview tools", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const server = createMcpServer();
  const client = new Client({ name: "test-client", version: "0.0.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["preflight_context", "read_page_preview"]);
  await client.close();
  await server.close();
});

test("read_page_preview returns full content for small pages and preview+upgrade otherwise", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const server = createMcpServer();
  const client = new Client({ name: "test-client", version: "0.0.1" });
  const [cT, sT] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(sT), client.connect(cT)]);

  // Small page served by a stubbed fetch.
  const g = globalThis;
  const orig = g.fetch;
  g.fetch = async () => new Response("<html><body><h1>Hi</h1><p>tiny</p></body></html>", { status: 200, headers: { "content-type": "text/html" } });
  try {
    const small = await client.callTool({ name: "read_page_preview", arguments: { url: "https://example.com/tiny" } });
    const smallBody = JSON.parse(small.content[0].text);
    assert.equal(smallBody.kind, "markdown");
    assert.match(smallBody.markdown, /# Hi/);
    assert.equal(smallBody.truncated_for_free_tier, undefined);
  } finally {
    g.fetch = orig;
  }

  // Big page → preview slice + upgrade pointer.
  g.fetch = async () => new Response("<html><body><p>" + "word ".repeat(3000) + "</p></body></html>", { status: 200, headers: { "content-type": "text/html" } });
  try {
    const big = await client.callTool({ name: "read_page_preview", arguments: { url: "https://example.com/big" } });
    const bigBody = JSON.parse(big.content[0].text);
    assert.equal(bigBody.truncated_for_free_tier, true);
    assert.ok(bigBody.preview.length <= 2000);
    assert.equal(bigBody.upgrade.price, "$0.01");
    assert.match(bigBody.upgrade.endpoint, /^https:\/\/agent-context-api-proxy/);
  } finally {
    g.fetch = orig;
  }

  // Private URL rejected before network I/O.
  const bad = await client.callTool({ name: "read_page_preview", arguments: { url: "http://169.254.169.254/" } });
  const badBody = JSON.parse(bad.content[0].text);
  assert.equal(badBody.error, "bad_url");

  await client.close();
  await server.close();
});
