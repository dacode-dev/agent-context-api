const AGENT_BOUNTIES_URL =
  "https://api.agentbounties.app/v1/opportunities?claimable_only=true";
const CLAW_HUNTER_URL =
  "https://clawhunter.fun/api/v1/bounties?types=AGENT&sort=score";

function amountToUnits(amount) {
  if (!amount) return null;
  const value = Number(amount.amount);
  const decimals = Number.isInteger(amount.decimals) ? amount.decimals : 6;
  return Number.isFinite(value) ? value / 10 ** decimals : null;
}

function futureDeadline(deadline, now = Date.now()) {
  return !deadline || (Number.isFinite(Date.parse(deadline)) && Date.parse(deadline) > now);
}

export function normalizeCanonical(item, now = Date.now()) {
  const reward = item.cash_economics?.solver_reward || item.reward;
  const bond = item.cash_economics?.refundable_claim_bond;
  const externalSpend = item.cash_economics?.required_external_spend;
  const verifiedFunding = item.payment_committed === true && item.payment_state === "escrowed";
  const claimable = item.source_status === "claimable" && item.work_state === "open";

  return {
    id: item.opportunity_id || item.source_id,
    source: "agent-bounties",
    title: item.title,
    goal: item.goal || null,
    url: item.public_url || item.source_url || null,
    bounty_id: item.next_action?.url?.match(/bounty_id=([^&]+)/)?.[1] || null,
    reward_usdc: amountToUnits(reward),
    deadline: item.deadline || null,
    skills: item.skills || [],
    work_state: item.work_state || item.source_status || null,
    payment_state: item.payment_state || null,
    payment_evidence: verifiedFunding ? "canonical_escrowed" : "not_verified",
    payment_committed: verifiedFunding,
    claimable: claimable && futureDeadline(item.deadline, now),
    requires_claim_bond_usdc: amountToUnits(bond),
    required_external_spend_usdc: amountToUnits(externalSpend),
    verification_method: item.verification_method || null,
    evidence_requirements: item.evidence_requirements || null,
    risk_flags: [
      amountToUnits(bond) > 0 ? "claim_bond_required" : null,
      amountToUnits(externalSpend) > 0 ? "external_spend_required" : null,
      !futureDeadline(item.deadline, now) ? "deadline_passed" : null,
    ].filter(Boolean),
  };
}

export function normalizeClawHunter(item, now = Date.now()) {
  return {
    id: item.id,
    source: item.source || "clawhunter",
    title: item.title,
    goal: item.summary || null,
    url: item.url || null,
    bounty_id: null,
    reward_usd: Number.isFinite(Number(item.rewardUsd)) ? Number(item.rewardUsd) : null,
    deadline: item.expiresAt || null,
    skills: item.requires || [],
    work_state: "listed",
    payment_state: "unverified",
    payment_evidence: "venue_listing_only",
    payment_committed: false,
    claimable: item.doability === "AGENT" && futureDeadline(item.expiresAt, now),
    requires_claim_bond_usdc: null,
    required_external_spend_usdc: null,
    verification_method: null,
    evidence_requirements: item.criteria || [],
    risk_flags: ["external_venue_verification_required"],
    submission_count: item.submissionCount ?? null,
    friction: item.friction || null,
  };
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchRadar({
  includeUnverified = false,
  minRewardUsd = 0,
  limit = 20,
  source = null,
  now = Date.now(),
} = {}) {
  const results = await Promise.allSettled([
    fetchJson(AGENT_BOUNTIES_URL, 8_000),
    fetchJson(CLAW_HUNTER_URL, 8_000),
  ]);
  const [canonicalResult, hunterResult] = results;
  const sourceStatuses = [
    {
      source: "agent-bounties",
      url: AGENT_BOUNTIES_URL,
      ok: canonicalResult.status === "fulfilled",
      error: canonicalResult.status === "rejected" ? canonicalResult.reason.message : null,
    },
    {
      source: "clawhunter",
      url: CLAW_HUNTER_URL,
      ok: hunterResult.status === "fulfilled",
      error: hunterResult.status === "rejected" ? hunterResult.reason.message : null,
    },
  ];

  if (!sourceStatuses.some((status) => status.ok)) {
    throw new Error("all bounty sources unavailable");
  }

  const canonicalItems = canonicalResult.status === "fulfilled"
    ? (canonicalResult.value.items || []).map((item) => normalizeCanonical(item, now))
    : [];
  const hunterItems = hunterResult.status === "fulfilled"
    ? (hunterResult.value.bounties || []).map((item) => normalizeClawHunter(item, now))
    : [];
  let items = includeUnverified ? [...canonicalItems, ...hunterItems] : canonicalItems;

  if (source) items = items.filter((item) => item.source === source);
  items = items
    .filter((item) => item.claimable && Number(item.reward_usd ?? item.reward_usdc ?? 0) >= minRewardUsd)
    .sort((a, b) => Number(b.reward_usd ?? b.reward_usdc ?? 0) - Number(a.reward_usd ?? a.reward_usdc ?? 0))
    .slice(0, Math.min(Math.max(Number(limit) || 20, 1), 100));

  return {
    generated_at: new Date(now).toISOString(),
    evidence_policy: "Only agent-bounties items marked payment_committed=true and payment_state=escrowed are called funded. Other listings are labeled unverified.",
    filters: { include_unverified: includeUnverified, min_reward_usd: minRewardUsd, source, limit },
    summary: {
      returned: items.length,
      verified_funded: items.filter((item) => item.payment_committed).length,
      unverified_listings: items.filter((item) => !item.payment_committed).length,
    },
    source_statuses: sourceStatuses,
    items,
  };
}
