// x402 endpoint verification engine — paid /v1/x402-verify route.
// Answers the buyer's real pre-purchase question: "will this x402 endpoint
// actually sell to me?" Pure helpers exported for tests; network via
// injected fetch.

const MAX_BYTES = 200_000;

export function classifyChallenge(response) {
  const headers = response.headers || {};
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  const challengeHeader =
    lower["x-payment-required"] ||
    lower["payment-required"] ||
    (lower["www-authenticate"] && /payment/i.test(lower["www-authenticate"]) ? lower["www-authenticate"] : undefined);
  return {
    status: response.status,
    is402: response.status === 402,
    hasChallengeHeader: Boolean(challengeHeader),
    challengeHeaderName: challengeHeader
      ? Object.keys(lower).find((k) => lower[k] === challengeHeader)
      : undefined,
    bodyExceptsPayment:
      typeof response.bodyText === "string" &&
      /payment[_ ]?required|x402|accepts:/i.test(response.bodyText.slice(0, 4000)),
  };
}

// Decodes a base64 x402 challenge (v1/v2 shape tolerant) and extracts the
// fields a payer cares about. Returns null when undecodable.
export function decodeChallenge(b64) {
  if (typeof b64 !== "string" || b64.length < 8) return null;
  try {
    const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    if (typeof json !== "object" || json === null) return null;
    // x402 v2: { x402Version, error?, accepts: [{ scheme, network, maxAmountRequired, resource, payTo }] }
    // v1-ish: { ... } flat or wrapped — be tolerant.
    const accepts = Array.isArray(json.accepts)
      ? json.accepts.map((a) => ({
          scheme: a.scheme,
          network: a.network,
          payTo: a.payTo || a.payToAddress,
          price: a.maxAmountRequired || a.maxRequiredPrice || a.price,
          asset: a.asset || (a.extra && a.extra.name),
        }))
      : [];
    return {
      x402Version: json.x402Version,
      error: json.error,
      accepts,
    };
  } catch {
    return null;
  }
}

function clampInt(v, lo, hi, dflt) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

// Probes one endpoint: unpaid request → expect 402 + challenge → decode it →
// report verdict. Never follows into paying; read-only from the buyer side.
export async function verifyEndpoint(rawUrl, opts = {}) {
  const timeoutMs = clampInt(opts.timeoutMs, 500, 15_000, 10_000);
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, error: "url must be absolute http(s)", code: "bad_url" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: "only http(s) supported", code: "bad_url" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rawUrl, {
      method: opts.method || "GET",
      signal: controller.signal,
      redirect: "manual",
      headers: { ...(opts.body ? { "content-type": "application/json" } : {}), "user-agent": "agent-context-x402-verifier/1.0", accept: "application/json, */*" },
      body: opts.body ? String(opts.body).slice(0, 10_000) : undefined,
    });
    let bodyText = "";
    try {
      const buf = await res.arrayBuffer();
      bodyText = new TextDecoder("utf-8", { fatal: false }).decode(buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf);
    } catch {}
    const cls = classifyChallenge({ status: res.status, headers: Object.fromEntries(res.headers.entries()), bodyText });
    const headerB64 = cls.challengeHeaderName ? res.headers.get(cls.challengeHeaderName) : null;
    const decoded = decodeChallenge(headerB64 || "");
    let verdict;
    if (!cls.is402) {
      verdict = res.ok ? "no_gate" : "error_response";
    } else if (cls.hasChallengeHeader || decoded) {
      verdict = decoded ? "sellable" : "challenge_undecodable";
    } else if (cls.bodyExceptsPayment) {
      verdict = "body_only_challenge";
    } else {
      verdict = "plain_402";
    }
    return {
      ok: true,
      url: rawUrl,
      probed_method: opts.method || "GET",
      status: res.status,
      verdict,
      challenge_header: cls.challengeHeaderName || null,
      challenge: decoded,
      hint:
        verdict === "sellable"
          ? "endpoint advertises payment terms; safe to attempt purchase"
          : verdict === "no_gate"
            ? "responded success without payment gate — not an x402 seller on this method"
            : verdict === "plain_402"
              ? "402 but no decodable challenge — cannot determine payTo/price"
              : undefined,
    };
  } catch (err) {
    const reason = err.name === "AbortError" ? `timeout after ${timeoutMs}ms` : err.message;
    return { ok: false, url: rawUrl, error: `probe failed: ${reason}`, code: err.name === "AbortError" ? "timeout" : "fetch_error" };
  } finally {
    clearTimeout(timer);
  }
}
