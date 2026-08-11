import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { analyzeContext } from "./analysis.js";

export const LOCAL_MAX_INPUT_CHARS = 12_000;
export const PAID_ENDPOINT = process.env.PAID_ENDPOINT || "https://agent-context-api-proxy.agent-context-proxy.workers.dev/v1/context-preflight";

export function createMcpServer() {
  const server = new McpServer({ name: "agent-context-api", version: "0.4.0" });
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
  return server;
}
