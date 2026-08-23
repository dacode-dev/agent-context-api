import express from "express";
import { paymentMiddleware } from "@x402/express";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareDiscoveryExtension, bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { readPage } from "./page-read.js";
import { analyzeContext, MAX_INPUT_CHARS } from "./analysis.js";
import { fetchRadar } from "./bounty-radar.js";
import { generateHealthReport } from "./payanagent-health.js";
import { generateMarketPulse } from "./market-pulse.js";
import { generateWorkBrief } from "./work-brief.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp-core.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const VERSION = process.env.npm_package_version || require("./package.json").version;

export const PRICE = "$0.005";
export const RADAR_PRICE = "$0.01";
export const HEALTH_PRICE = "$0.01";
export const MARKET_PULSE_PRICE = "$0.01";
export const WORK_BRIEF_PRICE = "$0.03";
export const READ_PAGE_PRICE = "$0.01";
export const PAY_TO = process.env.PAY_TO || "0xc4e8021CdFf1a11946Ed16bd264f77D6B3C0C0e9";
const HUB_PROXY_SECRET = process.env.HUB_PROXY_SECRET || "";

const SERVICE_DESCRIPTION = "Operated, fresh agent-market and Base market data with explicit source health and timestamps. Buyers pay for the maintained run, not private source code.";

export { analyzeContext, MAX_INPUT_CHARS } from "./analysis.js";

async function sendMarketPulse(_req, res) {
  try {
    res.json(await generateMarketPulse());
  } catch (error) {
    res.status(502).json({ error: `market data unavailable: ${error.message}` });
  }
}

export function createApp({ beforeMiddleware = null } = {}) {
  const app = express();
  app.disable("x-powered-by");
  // The service is normally behind a TLS-terminating reverse proxy/tunnel.
  // Preserve the public https:// resource URL in x402 payment requirements.
  app.set("trust proxy", true);
  app.use(express.json({ limit: "1mb" }));
  // A stable Cloudflare Worker proxy forwards this deployment-only marker so
  // x402 requirements name the stable public resource rather than the
  // disposable origin tunnel. Ignore it unless the exact configured host
  // matches; direct tunnel requests keep their normal Host header.
  const publicHosts = new Set(
    (process.env.PUBLIC_HOSTS || process.env.PUBLIC_HOST || "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );
  app.use((req, _res, next) => {
    const forwardedHost = (req.get("x-agent-public-host") || "").trim().toLowerCase();
    if (publicHosts.has(forwardedHost)) {
      req.headers.host = forwardedHost;
      req.headers["x-forwarded-proto"] = "https";
    }
    next();
  });
  // agent-tools hub forwards paid requests here after settlement. Keep this
  // route outside x402 middleware and require the hub-issued secret so the
  // upstream cannot be freeloaded through the durable gateway.
  app.use("/hub", (req, res) => {
    if (!HUB_PROXY_SECRET || req.get("x-hub-secret") !== HUB_PROXY_SECRET) {
      return res.status(404).json({ error: "not found" });
    }
    if ((req.method === "GET" || req.method === "POST") && req.path === "/v1/base-market-pulse") {
      return sendMarketPulse(req, res);
    }
    return res.status(404).json({ error: "not found" });
  });
  if (beforeMiddleware) app.use(beforeMiddleware);

  app.get("/health", (_req, res) => res.json({ ok: true, service: "agent-context-api", version: VERSION }));
  app.post("/mcp", async (req, res) => {
    const server = createMcpServer();
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => { transport.close(); server.close(); });
    } catch (error) {
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      console.error(`MCP request failed: ${error.message}`);
    }
  });
  app.get("/mcp", (_req, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));
  app.delete("/mcp", (_req, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));
  app.get("/", (_req, res) => res.json({
    service: "LLM Context Preflight",
    description: SERVICE_DESCRIPTION,
    managed_value: [
      "fresh execution against changing upstream sources",
      "normalization, source-health checks, and timestamps",
      "bounded latency and a maintained public endpoint",
    ],
    self_hosting_note: "The implementation is public; self-hosting is an option. The paid convenience is consuming an operated result without deploying, monitoring, or repairing the upstream integrations.",
    endpoints: ["POST /mcp", "POST /v1/context-preflight", "POST /v1/bounty-radar", "POST /v1/payanagent-health", "GET /v1/base-market-pulse", "POST /v1/base-market-pulse", "POST /v1/agent-work-brief", "POST /v1/read-page"],
    prices: { "POST /v1/context-preflight": PRICE, "POST /v1/bounty-radar": RADAR_PRICE, "POST /v1/payanagent-health": HEALTH_PRICE, "GET /v1/base-market-pulse": MARKET_PULSE_PRICE, "POST /v1/base-market-pulse": MARKET_PULSE_PRICE, "POST /v1/agent-work-brief": WORK_BRIEF_PRICE, "POST /v1/read-page": READ_PAGE_PRICE },
  }));

  app.get(["/.well-known/x402", "/.well-known/x402.json"], (req, res) => {
    const origin = `${req.protocol}://${req.get("host")}`;
    res.json({
      version: 1,
      service: "agent-context-api",
      description: SERVICE_DESCRIPTION,
      payment: { protocol: "x402", network: "eip155:8453", asset: "USDC", payTo: PAY_TO },
      resources: [
        { url: `${origin}/v1/context-preflight`, method: "POST", price_usdc: 0.005 },
        { url: `${origin}/v1/bounty-radar`, method: "POST", price_usdc: 0.01 },
        { url: `${origin}/v1/payanagent-health`, method: "POST", price_usdc: 0.01 },
        { url: `${origin}/v1/base-market-pulse`, method: "GET", price_usdc: 0.01 },
        { url: `${origin}/v1/base-market-pulse`, method: "POST", price_usdc: 0.01 },
        { url: `${origin}/v1/agent-work-brief`, method: "POST", price_usdc: 0.03 },
        { url: `${origin}/v1/read-page`, method: "POST", price_usdc: 0.01 },
      ],
      instructions: "Send the listed HTTP method without payment to receive the x402 payment requirements, then retry with a valid payment header.",
    });
  });

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

  app.post("/v1/agent-work-brief", async (req, res) => {
    try {
      const body = req.body || {};
      const minRewardUsd = Number(body.min_reward_usd || 0);
      if (!Number.isFinite(minRewardUsd) || minRewardUsd < 0) {
        return res.status(400).json({ error: "min_reward_usd must be a non-negative number" });
      }
      res.json(await generateWorkBrief({
        fetchRadar,
        generateHealthReport,
        minRewardUsd,
        limit: body.limit,
        healthLimit: body.health_limit,
      }));
    } catch (error) {
      res.status(502).json({ error: `agent work brief unavailable: ${error.message}` });
    }
  });

  app.post("/v1/read-page", async (req, res) => {
    try {
      const body = req.body || {};
      const result = await readPage(body.url, { maxBytes: body.max_bytes, timeoutMs: body.timeout_ms });
      if (!result.ok) {
        const status = result.code === "bad_url" ? 400 : 502;
        return res.status(status).json(result);
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: `read-page failed: ${error.message}` });
    }
  });

  app.get("/v1/base-market-pulse", sendMarketPulse);
  app.post("/v1/base-market-pulse", sendMarketPulse);
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
  const workBriefInputSchema = {
    type: "object",
    properties: {
      min_reward_usd: { type: "number", minimum: 0, default: 0, description: "Minimum gross reward for canonical escrowed work." },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 20, description: "Maximum opportunities to return." },
      health_limit: { type: "integer", minimum: 1, maximum: 25, default: 10, description: "Number of catalog offers to probe read-only." },
    },
  };
  const readPageInputSchema = {
    type: "object",
    required: ["url"],
    properties: {
      url: { type: "string", description: "Public http(s) URL of the page to read. Local/private network addresses are rejected." },
      max_bytes: { type: "integer", minimum: 1000, maximum: 1000000, default: 400000, description: "Maximum bytes to read from the response body before conversion." },
      timeout_ms: { type: "integer", minimum: 500, maximum: 20000, default: 12000, description: "Fetch timeout in milliseconds." },
    },
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
    "GET /v1/base-market-pulse": {
      accepts: { scheme: "exact", price: MARKET_PULSE_PRICE, network: "eip155:8453", payTo: PAY_TO, maxTimeoutSeconds: 60 },
      description: "Return a fresh informational Base ETH and DEX market snapshot from public Coinbase, DEX Screener, and Base RPC sources. No trade or transaction is executed.",
      mimeType: "application/json",
      extensions: {
        ...declareDiscoveryExtension({
          method: "GET",
          input: {},
          inputSchema: marketPulseInputSchema,
          output: { example: { generated_at: "2026-08-09T00:00:00.000Z", product: "Base ETH and DEX market pulse", summary: { sources_ok: 3, sources_total: 3, eth_usd: 2500, base_block_number: 123, base_gas_price_gwei: 0.01 } } },
        }),
      },
    },
    "POST /v1/agent-work-brief": {
      accepts: { scheme: "exact", price: WORK_BRIEF_PRICE, network: "eip155:8453", payTo: PAY_TO, maxTimeoutSeconds: 60 },
      description: "Combine fresh canonical escrowed agent work with bounded catalog liveness into a decision-ready brief. Excludes unfunded listings and classifies capital requirements.",
      mimeType: "application/json",
      extensions: {
        ...declareDiscoveryExtension({
          input: { min_reward_usd: 0, limit: 20, health_limit: 10 },
          inputSchema: workBriefInputSchema,
          bodyType: "json",
          output: { example: { generated_at: "2026-08-11T00:00:00.000Z", summary: { opportunities: 1, ready_to_evaluate: 1, capital_required: 0, catalog_alive: 3 }, opportunities: [] } },
        }),
      },
    },
    "POST /v1/read-page": {
      accepts: { scheme: "exact", price: READ_PAGE_PRICE, network: "eip155:8453", payTo: PAY_TO, maxTimeoutSeconds: 30 },
      description: "Fetch a public http(s) page and return clean Markdown (or plain text for non-HTML) with final URL, status, byte counts, and truncation flag. SSRF-guarded, size- and time-bounded. Built for agents that need to read the web.",
      mimeType: "application/json",
      extensions: {
        ...declareDiscoveryExtension({
          method: "POST",
          input: { url: "https://example.com", max_bytes: 200000, timeout_ms: 12000 },
          inputSchema: readPageInputSchema,
          bodyType: "json",
          output: { example: { ok: true, requested_url: "https://example.com", final_url: "https://example.com/", status: 200, content_type: "text/html", kind: "markdown", markdown: "# Example Domain\n\nThis domain is for use in illustrative examples...", bytes_fetched: 1256, total_bytes: 1256, truncated: false } },
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
