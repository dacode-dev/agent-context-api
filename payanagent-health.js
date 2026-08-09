const API_ORIGIN = "https://payanagent.com";
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 25;
const CATALOG_TIMEOUT_MS = 8_000;
const PROBE_TIMEOUT_MS = 4_000;
const CONCURRENCY = 6;

function boundedLimit(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(Math.max(Math.trunc(number), 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
}

function absoluteUrl(value) {
  if (!value) return null;
  try {
    return new URL(value, API_ORIGIN).toString();
  } catch {
    return null;
  }
}

async function fetchJson(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`catalog HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function collectOffers(limit = DEFAULT_LIMIT, { fetchImpl = fetch } = {}) {
  const target = boundedLimit(limit);
  const offers = [];
  const seen = new Set();
  let cursor = null;

  // Cursor pagination is bounded so a malformed catalog cannot cause an
  // unbounded paid request. Only public catalog metadata is read.
  for (let page = 0; page < 10 && offers.length < target; page += 1) {
    const params = new URLSearchParams({ sort: "top", limit: String(Math.min(100, target - offers.length)) });
    if (cursor) params.set("cursor", cursor);
    const body = await fetchJson(`${API_ORIGIN}/api/v1/offers?${params}`, fetchImpl);
    for (const offer of body.offers || []) {
      const id = offer._id || offer.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      offers.push(offer);
      if (offers.length >= target) break;
    }
    const next = body.nextCursor || body.next_cursor || null;
    if (!next || next === cursor || !(body.offers || []).length) break;
    cursor = next;
  }
  return offers.slice(0, target);
}

export function classifyProbe(httpCode) {
  if (httpCode === 402 || (httpCode >= 200 && httpCode < 300)) return "alive";
  if (httpCode >= 400 && httpCode < 500) return "4xx";
  if (httpCode >= 500) return "5xx";
  return "dead";
}

export async function probeOffer(offer, { fetchImpl = fetch } = {}) {
  const endpoint = absoluteUrl(offer.buyUrl || offer.endpoint || offer.url);
  if (!endpoint) return { status: "dead", http_code: null, latency_ms: 0, endpoint: null };

  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    let response = await fetchImpl(endpoint, {
      method: "HEAD",
      redirect: "manual",
      signal: controller.signal,
    });
    // HEAD and OPTIONS are intentionally the only methods used. A 402 is a
    // useful liveness signal; no payment header or body is ever sent.
    if (response.status === 405 || response.status === 501) {
      response = await fetchImpl(endpoint, {
        method: "OPTIONS",
        redirect: "manual",
        signal: controller.signal,
      });
    }
    return {
      endpoint,
      status: classifyProbe(response.status),
      http_code: response.status,
      latency_ms: Math.round(performance.now() - started),
    };
  } catch (error) {
    return {
      endpoint,
      status: error?.name === "AbortError" ? "timeout" : "dead",
      http_code: null,
      latency_ms: Math.round(performance.now() - started),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function mapConcurrent(items, worker) {
  const output = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run));
  return output;
}

export async function generateHealthReport({ limit = DEFAULT_LIMIT, fetchImpl = fetch, now = Date.now() } = {}) {
  const requestedLimit = boundedLimit(limit);
  const offers = await collectOffers(requestedLimit, { fetchImpl });
  const rows = await mapConcurrent(offers, async (offer) => ({
    offer_id: offer._id || offer.id || null,
    title: offer.title || offer.name || "untitled",
    ...(await probeOffer(offer, { fetchImpl })),
  }));
  const counts = rows.reduce((result, row) => {
    result[row.status] = (result[row.status] || 0) + 1;
    return result;
  }, {});

  return {
    generated_at: new Date(now).toISOString(),
    source: `${API_ORIGIN}/api/v1/offers?sort=top`,
    requested_limit: requestedLimit,
    checked: rows.length,
    paid_calls_made: 0,
    summary: {
      alive: counts.alive || 0,
      four_xx: counts["4xx"] || 0,
      five_xx: counts["5xx"] || 0,
      timeout: counts.timeout || 0,
      dead: counts.dead || 0,
    },
    rows,
    methodology: "Fresh public catalog read followed by bounded read-only HEAD/OPTIONS probes; 402 is classified as alive and no payment header is sent.",
  };
}
