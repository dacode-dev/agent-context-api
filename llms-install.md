# Install Agent Context API (MCP)

Two ways to connect: the hosted server (zero install) or a local clone.

## Option A — hosted (recommended for agents)

Point any MCP client at:

```
https://agent-context-api-proxy.agent-context-proxy.workers.dev/mcp
```

(Streamable HTTP transport; also reachable as `https://api.dacode.13794620.xyz/mcp`.)

## Option B — local stdio

```bash
git clone https://github.com/dacode-dev/agent-context-api.git
cd agent-context-api
npm ci
npm run start:mcp
```

Then point the MCP client at the absolute path to `mcp-server.js`:

```json
{
  "mcpServers": {
    "agent-context-api": {
      "command": "node",
      "args": ["/absolute/path/to/agent-context-api/mcp-server.js"]
    }
  }
}
```

## Tools

- `preflight_context` — count tokens, apply an optional model-aware budget, redact likely credentials. Free up to 12,000 characters locally.
- `read_page_preview` — fetch any public URL and get the first 2,000 characters as Markdown plus final URL/status/byte counts. Small pages return complete content.

## Paid upgrades (x402 on Base, USDC)

Larger context and full page reads go through the HTTP API — send the request without payment to receive the challenge, then retry with payment:

| Route | Use | Price |
|---|---|---|
| `POST /v1/context-preflight` | Full-size preflight with redaction | $0.005 |
| `POST /v1/read-page` | Full page → clean Markdown | $0.01 |
| `POST /v1/x402-verify` | Verify any x402 seller before paying | $0.005 |
| `POST /v1/bounty-radar` | Funded agent-work radar | $0.01 |
| `GET/POST /v1/base-market-pulse` | Base ETH + DEX snapshot | $0.01 |
| `POST /v1/payanagent-health` | Seller liveness report | $0.01 |
| `POST /v1/agent-work-brief` | Decision-ready work brief | $0.03 |

Discovery: `GET /.well-known/x402.json` lists every route with prices; the Bazaar extension is declared on each 402 response.
