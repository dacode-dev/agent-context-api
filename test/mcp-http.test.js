import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../server.js";

async function callMcp(port, body) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });
  return { response, text: await response.text() };
}

test("stateless MCP HTTP endpoint serves initialize and tools/list", async () => {
  const httpServer = createApp().listen(0);
  const { port } = httpServer.address();
  try {
    const initialized = await callMcp(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } },
    });
    assert.equal(initialized.response.status, 200);
    assert.equal(initialized.response.headers.get("content-type"), "text/event-stream");
    assert.match(initialized.text, /agent-context-api/);

    const listed = await callMcp(port, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    assert.equal(listed.response.status, 200);
    assert.match(listed.text, /preflight_context/);
  } finally {
    httpServer.close();
  }
});
