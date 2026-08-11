import test from "node:test";
import assert from "node:assert/strict";
import { analyzeContext, createApp } from "../server.js";
import { normalizeCanonical, normalizeClawHunter } from "../bounty-radar.js";

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
  assert.deepEqual(await response.json(), { ok: true, service: "agent-context-api", version: "0.4.0" });
  server.close();
});

test("x402 manifest publishes host-relative resources and payment metadata", async () => {
  const server = createApp().listen(0);
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/.well-known/x402`);
  assert.equal(response.status, 200);
  const manifest = await response.json();
  assert.equal(manifest.payment.network, "eip155:8453");
  assert.equal(manifest.payment.asset, "USDC");
  assert.ok(manifest.resources.some((resource) => resource.url === `http://127.0.0.1:${port}/v1/base-market-pulse` && resource.method === "GET"));
  server.close();
});

test("hub upstream is closed when no hub secret is configured", async () => {
  const server = createApp().listen(0);
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/hub/v1/base-market-pulse`);
  assert.equal(response.status, 404);
  server.close();
});

test("bounty radar labels only canonical escrow as funded", () => {
  const canonical = normalizeCanonical({
    opportunity_id: "canonical:test",
    title: "Funded task",
    source_status: "claimable",
    work_state: "open",
    payment_state: "escrowed",
    payment_committed: true,
    reward: { amount: "900000", decimals: 6, currency: "USDC" },
    cash_economics: { refundable_claim_bond: { amount: "100000", decimals: 6 }, required_external_spend: { amount: "0", decimals: 6 } },
    deadline: "2099-01-01T00:00:00Z",
  }, Date.parse("2026-08-09T00:00:00Z"));
  assert.equal(canonical.payment_committed, true);
  assert.equal(canonical.reward_usdc, 0.9);
  assert.equal(canonical.claimable, true);
  assert.deepEqual(canonical.risk_flags, ["claim_bond_required"]);

  const listing = normalizeClawHunter({ id: "listing:test", title: "Listed task", doability: "AGENT", rewardUsd: 12, expiresAt: "2099-01-01T00:00:00Z" }, Date.parse("2026-08-09T00:00:00Z"));
  assert.equal(listing.payment_committed, false);
  assert.equal(listing.payment_evidence, "venue_listing_only");
});
