import assert from "node:assert/strict";
import test from "node:test";
import { generateWorkBrief, rankOpportunities } from "../work-brief.js";

test("rankOpportunities puts no-capital work first", () => {
  const result = rankOpportunities([
    { id: "bond", reward_usdc: 20, requires_claim_bond_usdc: 1, risk_flags: ["claim_bond_required"] },
    { id: "ready", reward_usdc: 2, requires_claim_bond_usdc: 0, required_external_spend_usdc: 0, risk_flags: [] },
  ]);
  assert.deepEqual(result.map((item) => [item.id, item.execution_class]), [["ready", "ready_to_evaluate"], ["bond", "capital_required"]]);
});

test("generateWorkBrief preserves partial source failures", async () => {
  const brief = await generateWorkBrief({
    fetchRadar: async () => { throw new Error("radar unavailable"); },
    generateHealthReport: async () => ({ source: "catalog", checked: 2, summary: { alive: 1 } }),
    now: Date.parse("2026-08-11T00:00:00Z"),
  });
  assert.equal(brief.summary.radar_ok, false);
  assert.equal(brief.summary.health_ok, true);
  assert.equal(brief.summary.catalog_not_alive, 1);
  assert.equal(brief.partial_failures[0].source, "work_radar");
});
