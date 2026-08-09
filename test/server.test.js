import test from "node:test";
import assert from "node:assert/strict";
import { analyzeContext, createApp } from "../server.js";

test("analyzeContext counts, redacts, and applies model budget", () => {
  const result = analyzeContext({ text: "API_KEY=supersecretvalue123", model: "claude-sonnet" });
  assert.equal(result.redacted_count, 1);
  assert.ok(result.tokens > 0);
  assert.equal(result.effective_budget, 170000);
  assert.equal(result.fits_budget, true);
  assert.ok(!result.redacted_text.includes("supersecretvalue123"));
});

test("analyzeContext honors an explicit budget", () => {
  const result = analyzeContext({ text: "hello world", tokenBudget: 1 });
  assert.equal(result.effective_budget, 1);
  assert.equal(result.fits_budget, false);
});

test("health endpoint is free and reports service identity", async () => {
  const server = createApp().listen(0);
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "agent-context-api", version: "0.1.0" });
  server.close();
});
