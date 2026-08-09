import express from "express";
import { paymentMiddleware } from "@x402/express";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareDiscoveryExtension, bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { countTokens, redactSecrets, budgetForModel } from "./analysis.js";
import { fetchRadar } from "./bounty-radar.js";
import { generateHealthReport } from "./payanagent-health.js";
import { generateMarketPulse } from "./market-pulse.js";

export const MAX_INPUT_CHARS = 200_000;
export const PRICE = "$0.005";
export const RADAR_PRICE = "$0.01";
export const HEALTH_PRICE = "$0.01";
export const MARKET_PULSE_PRICE = "$0.01";
export const PAY_TO = process.env.PAY_TO || "0xc4e8021CdFf1a11946Ed16bd264f77D6B3C0C0e9";

export function analyzeContext({ text, model = null, tokenBudget = null, redact = true }) {
  if (typeof text !== "string") throw new Error("text must be a string");
  if (text.length > MAX_INPUT_CHARS) throw new Error(`text exceeds ${MAX_INPUT_CHARS} characters`);
  const result = redact ? redactSecrets(text) : { content: text, count: 0 };
  const tokens = countTokens(result.content);
  const modelBudget = model ? budgetForModel(model) : null;
  const effectiveBudget = Number.isInteger(tokenBudget) && tokenBudget > 0 ? tokenBudget : modelBudget;
  return {
    tokens,
    redacted_count: result.count,
    redacted_text: result.content,
    model,
    model_budget: modelBudget,
    requested_budget: tokenBudget,
    effective_budget: effectiveBudget,
    fits_budget: effectiveBudget === null ? null : tokens <= effectiveBudget,
    recommendation:
      effectiveBudget !== null && tokens > effectiveBudget
        ? "Reduce the context or raise the model budget before sending it."
        : "Context is within the requested budget.",
  };
}

export function createApp({ beforeMiddleware = null } = {}) {
  const app = express();
  app.disable("x-powered-by");
  // The service is normally behind a TLS-terminating reverse proxy/tunnel.
  // Preserve the public https:// resource URL in x402 payment requirements.
  app.set("trust proxy", true);
  app.use(express.json({ limit: "1mb" }));
  if (beforeMiddleware) app.use(beforeMiddleware);

  app.get("/health", (_req, res) => res.json({ ok: true, service: "agent-context-api", version: "0.4.0" }));
  app.get("/", (_req, res) => res.json({
    service: "LLM Context Preflight",
    description: "Deterministic context analysis plus operated, fresh agent-market data.",
    endpoints: ["POST /v1/context-preflight", "POST /v1/bounty-radar", "POST /v1/payanagent-health", "POST /v1/base-market-pulse"],
    prices: { "POST /v1/context-preflight": PRICE, "POST /v1/bounty-radar": RADAR_PRICE, "POST /v1/payanagent-health": HEALTH_PRICE, "POST /v1/base-market-pulse": MARKET_PULSE_PRICE },
  }));

  app.post("/v1/context-preflight", (req, res) => {
    try {
      const { text, model = null, token_budget: tokenBudget = null, redact = true } = req.body || {};
      res.json(analyzeContext({ text, model, tokenBudget, redact }));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/v1/bounty-radar", async (req, res) => {
    try {
      const body = req.body || {};
      const minRewardUsd = Number(body.min_reward_usd || 0);
      if (!Number.isFinite(minRewardUsd) || minRewardUsd < 0) {
        return res.status(400).json({ error: "min_reward_usd must be a non-negative number" });
      }
      res.json(await fetchRadar({
        includeUnverified: body.include_unverified === true,
        minRewardUsd,
        limit: body.limit,
        source: typeof body.source === "string" ? body.source : null,
      }));
    } catch (error) {
      res.status(502).json({ error: `bounty sources unavailable: ${error.message}` });
    }
  });

  app.post("/v1/payanagent-health", async (req, res) => {
    try {
      const body = req.body || {};
      res.json(await generateHealthReport({ limit: body.limit }));
    } catch (error) {
      res.status(502).json({ error: `PayanAgent catalog unavailable: ${error.message}` });
    }
  });

  app.post("/v1/base-market-pulse", async (_req, res) => {
    try {
      res.json(await generateMarketPulse());
    } catch (error) {
      res.status(502).json({ error: `market data unavailable: ${error.message}` });
    }
  });
  return app;
}

export function createPaidApp() {
  const facilitator = new HTTPFacilitatorClient({ url: process.env.X402_FACILITATOR || "https://x402.org/facilitator" });
  const resourceServer = new x402ResourceServer(facilitator)
    .register("eip155:8453", new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);
  const inputSchema = {
    type: "object",
    properties: {
      text: { type: "string", description: "Text or code to preflight, up to 200,000 characters." },
      model: { type: ["string", "null"], description: "Optional model name such as claude-sonnet or gpt-4o." },
      token_budget: { type: ["integer", "null"], minimum: 1, description: "Optional hard token budget." },
      redact: { type: "boolean", default: true, description: "Redact likely API keys and credentials." },
    },
    required: ["text"],
  };
  const outputExample = {
    tokens: 42,
    redacted_count: 1,
    effective_budget: 170000,
    fits_budget: true,
    recommendation: "Context is within the requested budget.",
  };
  const radarInputSchema = {
    type: "object",
    properties: {
      include_unverified: { type: "boolean", default: false, description: "Include listings without canonical escrow evidence, clearly labeled as unverified." },
      min_reward_usd: { type: "number", minimum: 0, default: 0, description: "Minimum reward filter." },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 20, description: "Maximum number of results." },
      source: { type: ["string", "null"], description: "Optional source filter, such as agent-bounties or clawhunter." },
    },
  };
  const healthInputSchema = {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 25, default: 25, description: "Number of ranked public offers to check; capped at 25 for bounded latency." },
    },
  };
  const marketPulseInputSchema = {
    type: "object",
    properties: {},
    additionalProperties: false,
  };
  const routes = {
    "POST /v1/context-preflight": {
      accepts: { scheme: "exact", price: PRICE, network: "eip155:8453", payTo: PAY_TO, maxTimeoutSeconds: 60 },
      description: "For coding agents: count GPT-family tokens, apply an optional model-aware budget, and redact likely secrets before sending repository context to an LLM.",
      mimeType: "application/json",
      extensions: {
        ...declareDiscoveryExtension({ input: { text: "const key = 'sk-live-example';", model: "claude-sonnet", token_budget: 1000, redact: true }, inputSchema, bodyType: "json", output: { example: outputExample } }),
      },
    },
    "POST /v1/bounty-radar": {
      accepts: { scheme: "exact", price: RADAR_PRICE, network: "eip155:8453", payTo: PAY_TO, maxTimeoutSeconds: 60 },
      description: "Return a fresh, normalized agent-work feed with explicit escrow evidence, claim bonds, deadlines, and source-health labels. Only canonical escrowed items are called funded.",
      mimeType: "application/json",
      extensions: {
        ...declareDiscoveryExtension({
          input: { include_unverified: false, min_reward_usd: 0, limit: 20, source: null },
          inputSchema: radarInputSchema,
          bodyType: "json",
          output: { example: { generated_at: "2026-08-09T00:00:00.000Z", summary: { returned: 1, verified_funded: 1, unverified_listings: 0 }, items: [{ title: "Example funded task", payment_committed: true, payment_evidence: "canonical_escrowed" }] } },
        }),
      },
    },
    "POST /v1/payanagent-health": {
      accepts: { scheme: "exact", price: HEALTH_PRICE, network: "eip155:8453", payTo: PAY_TO, maxTimeoutSeconds: 60 },
      description: "Return a fresh read-only health snapshot of the ranked PayanAgent catalog. The operation probes public routes with HEAD/OPTIONS only and never makes paid calls.",
      mimeType: "application/json",
      extensions: {
        ...declareDiscoveryExtension({
          input: { limit: 25 },
          inputSchema: healthInputSchema,
          bodyType: "json",
          output: { example: { generated_at: "2026-08-09T00:00:00.000Z", checked: 2, paid_calls_made: 0, summary: { alive: 1, four_xx: 0, five_xx: 1, timeout: 0, dead: 0 }, rows: [{ offer_id: "offer_example", title: "Example service", status: "alive", http_code: 402, latency_ms: 120 }] } },
        }),
      },
    },
    "POST /v1/base-market-pulse": {
      accepts: { scheme: "exact", price: MARKET_PULSE_PRICE, network: "eip155:8453", payTo: PAY_TO, maxTimeoutSeconds: 60 },
      description: "Return a fresh informational Base ETH and DEX market snapshot from public Coinbase, DEX Screener, and Base RPC sources. No trade or transaction is executed.",
      mimeType: "application/json",
      extensions: {
        ...declareDiscoveryExtension({
          input: {},
          inputSchema: marketPulseInputSchema,
          bodyType: "json",
          output: { example: { generated_at: "2026-08-09T00:00:00.000Z", product: "Base ETH and DEX market pulse", summary: { sources_ok: 3, sources_total: 3, eth_usd: 2500, base_block_number: 123, base_gas_price_gwei: 0.01 } } },
        }),
      },
    },
  };
  const middleware = paymentMiddleware(routes, resourceServer);
  return { app: createApp({ beforeMiddleware: middleware }), middleware };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const port = Number(process.env.PORT || 8787);
  const { app } = createPaidApp();
  app.listen(port, "0.0.0.0", () => console.log(`agent-context-api listening on ${port}`));
}
