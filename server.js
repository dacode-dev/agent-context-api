import express from "express";
import { paymentMiddleware } from "@x402/express";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareDiscoveryExtension, bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { countTokens, redactSecrets, budgetForModel } from "../ctx-budget/src/lib.js";

export const MAX_INPUT_CHARS = 200_000;
export const PRICE = "$0.005";
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

  app.get("/health", (_req, res) => res.json({ ok: true, service: "agent-context-api", version: "0.1.0" }));
  app.get("/", (_req, res) => res.json({
    service: "LLM Context Preflight",
    description: "Count tokens, apply a model-aware budget, and redact likely secrets before an agent sends context.",
    endpoint: "POST /v1/context-preflight",
    price: PRICE,
  }));

  app.post("/v1/context-preflight", (req, res) => {
    try {
      const { text, model = null, token_budget: tokenBudget = null, redact = true } = req.body || {};
      res.json(analyzeContext({ text, model, tokenBudget, redact }));
    } catch (error) {
      res.status(400).json({ error: error.message });
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
  const routes = {
    "POST /v1/context-preflight": {
      accepts: { scheme: "exact", price: PRICE, network: "eip155:8453", payTo: PAY_TO, maxTimeoutSeconds: 60 },
      description: "For coding agents: count GPT-family tokens, apply an optional model-aware budget, and redact likely secrets before sending repository context to an LLM.",
      mimeType: "application/json",
      extensions: {
        ...declareDiscoveryExtension({ input: { text: "const key = 'sk-live-example';", model: "claude-sonnet", token_budget: 1000, redact: true }, inputSchema, bodyType: "json", output: { example: outputExample } }),
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
