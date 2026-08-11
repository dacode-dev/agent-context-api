function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function classifyOpportunity(item) {
  const requiresBond = numeric(item.requires_claim_bond_usdc) > 0;
  const requiresSpend = numeric(item.required_external_spend_usdc) > 0;
  return {
    ...item,
    execution_class: requiresSpend || requiresBond ? "capital_required" : "ready_to_evaluate",
    decision_risks: Array.isArray(item.risk_flags) ? item.risk_flags : [],
  };
}

export function rankOpportunities(items) {
  return [...items]
    .map(classifyOpportunity)
    .sort((a, b) => {
      const classScore = (value) => value === "ready_to_evaluate" ? 1 : 0;
      return classScore(b.execution_class) - classScore(a.execution_class)
        || numeric(b.reward_usdc ?? b.reward_usd) - numeric(a.reward_usdc ?? a.reward_usd);
    });
}

export async function generateWorkBrief({
  fetchRadar,
  generateHealthReport,
  minRewardUsd = 0,
  limit = 20,
  healthLimit = 10,
  now = Date.now(),
} = {}) {
  const [radarResult, healthResult] = await Promise.allSettled([
    fetchRadar({ includeUnverified: false, minRewardUsd, limit, now }),
    generateHealthReport({ limit: healthLimit, now }),
  ]);
  const radar = radarResult.status === "fulfilled" ? radarResult.value : null;
  const health = healthResult.status === "fulfilled" ? healthResult.value : null;
  const opportunities = rankOpportunities(radar?.items || []);

  return {
    generated_at: new Date(now).toISOString(),
    product: "Managed agent-work decision brief",
    evidence_policy: "Only canonical escrowed work is included. Listings without committed escrow are excluded rather than presented as funded.",
    sources: {
      work_radar: radar?.source_statuses || null,
      catalog_health: health ? { source: health.source, checked: health.checked } : null,
    },
    summary: {
      radar_ok: Boolean(radar),
      health_ok: Boolean(health),
      opportunities: opportunities.length,
      ready_to_evaluate: opportunities.filter((item) => item.execution_class === "ready_to_evaluate").length,
      capital_required: opportunities.filter((item) => item.execution_class === "capital_required").length,
      catalog_alive: health?.summary?.alive || 0,
      catalog_not_alive: health ? health.checked - health.summary.alive : null,
    },
    opportunities,
    catalog_health: health,
    partial_failures: [
      radarResult.status === "rejected" ? { source: "work_radar", error: radarResult.reason.message } : null,
      healthResult.status === "rejected" ? { source: "catalog_health", error: healthResult.reason.message } : null,
    ].filter(Boolean),
    methodology: "One bounded fetch of canonical escrowed opportunities plus a bounded read-only catalog probe. No claims, payments, or paid downstream calls are made.",
  };
}
