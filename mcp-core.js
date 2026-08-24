import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { analyzeContext } from "./analysis.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const VERSION = process.env.npm_package_version || require("./package.json").version;

export const LOCAL_MAX_INPUT_CHARS = 12_000;
export const PAID_ENDPOINT = process.env.PAID_ENDPOINT || "https://agent-context-api-proxy.agent-context-proxy.workers.dev/v1/context-preflight";

export function createMcpServer() {
  const server = new McpServer({ name: "agent-context-api", version: VERSION });
  server.registerTool(
    "preflight_context",
    {
      description:
        "Count tokens, apply an optional model-aware budget, and redact likely credentials locally. Inputs over 12,000 characters require the paid HTTP API.",
      inputSchema: {
        text: z.string().describe("Text or code to preflight."),
        model: z.string().nullable().optional().describe("Optional model name."),
        token_budget: z.number().int().positive().nullable().optional().describe("Optional hard token budget."),
        redact: z.boolean().optional().default(true).describe("Redact likely credentials."),
      },
    },
    async ({ text, model = null, token_budget: tokenBudget = null, redact = true }) => {
      if (text.length > LOCAL_MAX_INPUT_CHARS) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: JSON.stringify({
              error: "local_free_limit_exceeded",
              message: `The local MCP free tier accepts at most ${LOCAL_MAX_INPUT_CHARS} characters. Use the paid HTTP endpoint for larger context.`,
              endpoint: PAID_ENDPOINT,
              price: "$0.005",
              network: "Base USDC via x402",
            }, null, 2),
          }],
        };
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify(analyzeContext({ text, model, tokenBudget, redact }), null, 2),
        }],
      };
    },
  );

  // Free local preview of read_page: fetches and converts a page, but only
  // returns the first slice. The full result requires the paid HTTP API.
  const READ_PREVIEW_CHARS = 2_000;
  const PAID_READ_ENDPOINT = process.env.PAID_READ_ENDPOINT || "https://agent-context-api-proxy.agent-context-proxy.workers.dev/v1/read-page";
  server.registerTool(
    "read_page_preview",
    {
      description:
        "Fetch a public web page and return its beginning as Markdown (first 2,000 characters) plus final URL, status, and byte counts. Free local preview; the full page requires the paid HTTP API (x402, $0.01/call).",
      inputSchema: {
        url: z.string().describe("Public http(s) URL to read."),
        max_bytes: z.number().int().positive().max(1_000_000).optional().describe("Max bytes fetched from the response body."),
      },
    },
    async ({ url, max_bytes }) => {
      const { readPage } = await import("./page-read.js");
      const r = await readPage(url, { maxBytes: max_bytes });
      if (!r.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: r.code || "fetch_error", message: r.error }, null, 2) }],
        };
      }
      const body = r.kind === "markdown" ? r.markdown : r.text;
      const paid = {
        endpoint: PAID_READ_ENDPOINT,
        price: "$0.01",
        network: "Base USDC via x402",
      };
      if (body.length <= READ_PREVIEW_CHARS && !r.truncated) {
        return {
          content: [{ type: "text", text: JSON.stringify({ ...r, note: "full content returned (small page)" }, null, 2) }],
        };
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ...r,
            markdown: undefined,
            text: undefined,
            kind: r.kind,
            preview: body.slice(0, READ_PREVIEW_CHARS),
            truncated_for_free_tier: true,
            upgrade: paid,
          }, null, 2),
        }],
      };
    },
  );

  // ipintel MCP tool: free lookups against the operated backend (same free tier
  // as the branded endpoint). Risk scoring + privacy flags are fully returned.
  const IPINTEL_BACKEND = process.env.IPINTEL_BACKEND || "http://127.0.0.1:8920";
  server.registerTool(
    "ip_intel",
    {
      description:
        "Look up an IPv4/IPv6 address: country, ASN with hosting/ISP classification, VPN/proxy/Tor/datacenter flags from daily-refreshed lists, and an explainable risk score (0-100) naming every contributing signal.",
      inputSchema: {
        ip: z.string().describe("IPv4 or IPv6 address to look up."),
      },
    },
    async ({ ip }) => {
      try {
        const upstream = await fetch(`${IPINTEL_BACKEND}/v1/lookup?ip=${encodeURIComponent(ip)}`, { signal: AbortSignal.timeout(8000) });
        const data = await upstream.json();
        if (!upstream.ok || data.error) {
          return {
            isError: true,
            content: [{ type: "text", text: JSON.stringify({ error: data.error || "backend_error", status: upstream.status }, null, 2) }],
          };
        }
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: "backend_unavailable", message: error.message }, null, 2) }],
        };
      }
    },
  );
  return server;
}
