# Agent Context API

A small paid API for coding agents that need a deterministic context preflight before sending repository text to an LLM. It counts GPT-family tokens, applies an optional model-aware budget, and redacts likely credentials.

It also exposes managed data experiments. `bounty-radar` normalizes live agent-work listings and preserves the difference between a canonical escrow signal and an ordinary venue listing. `payanagent-health` produces a fresh liveness snapshot of the ranked PayanAgent catalog. `base-market-pulse` combines fresh public ETH, DEX, and Base-network signals. The source code is public, but the paid value is operated aggregation, source health, bounded probing, and timestamped results that a buyer does not have to run.

`agent-work-brief` is the decision-oriented bundle: it combines canonical escrowed work with catalog liveness, excludes ordinary unfunded listings, and classifies opportunities that require capital before an agent spends time evaluating them.

## Why pay when the source is public?

Self-hosting is deliberately allowed. The paid convenience is the maintained run: polling changing upstreams, normalizing responses, detecting partial outages, enforcing bounded work, and serving a timestamped result from a ready endpoint. A buyer can fork the code, but then owns deployment, monitoring, rate-limit handling, schema drift, and repairs. There is no claim of exclusivity; the service must earn trust through freshness and reliable operation.

## Local development

```bash
npm install
npm test
X402_FACILITATOR=https://facilitator.openx402.ai npm start
```

The service listens on `http://localhost:8787` by default. `GET /health` is free. `POST /v1/context-preflight` returns an x402 `402 Payment Required` response until the caller supplies a valid Base USDC payment.

For production Base mainnet operation, use a facilitator that advertises `x402Version: 2`, `scheme: exact`, and `network: eip155:8453` at its `/supported` endpoint; the maintained deployment uses `https://facilitator.openx402.ai`. The public `https://x402.org/facilitator` endpoint is suitable for Base Sepolia testing, not this mainnet payout configuration. Always verify current facilitator support before changing deployments.

## API example

```bash
curl -X POST http://localhost:8787/v1/context-preflight \
  -H 'content-type: application/json' \
  -d '{"text":"const token = \"sk-example\";","model":"claude-sonnet","token_budget":1000}'
```

The default price is `$0.005` per request. Set `PAY_TO` to change the public payout address, `X402_FACILITATOR` to select a compatible facilitator, and `PUBLIC_HOSTS` to provide a comma-separated allowlist of Worker/custom hostnames used in x402 resource URLs. Do not put private keys or facilitator credentials in this repository; the service does not need a signing key to receive payments.

## Managed bounty radar

`POST /v1/bounty-radar` costs `$0.01` through x402. Send filters such as:

```json
{"include_unverified":false,"min_reward_usd":0,"limit":20}
```

The response includes source health, deadlines, claim bonds, external-spend requirements, and a `payment_evidence` field. Only listings explicitly marked canonical and escrowed are labeled funded; other listings remain visible only when requested and are labeled unverified.

## PayanAgent catalog health

`POST /v1/payanagent-health` costs `$0.01` through x402. It accepts an optional `limit` from 1 to 25 and checks the ranked public catalog using only read-only `HEAD` requests (falling back to `OPTIONS` when required). HTTP 402 means that a live payment gate responded; the service never sends payment headers or calls paid routes. The response contains per-offer status, HTTP code, latency, summary counts, and `generated_at`.

## Base market pulse

`POST /v1/base-market-pulse` costs `$0.01` through x402 and accepts `{}`. The equivalent `GET` route exists for agent directories and simple HTTP clients. It reads Coinbase's public ETH/USD spot endpoint, DEX Screener's public Base WETH/USDC pair feed, and public Base JSON-RPC methods for the current block and gas price. It returns per-source health, timestamped values, and partial results when one source is unavailable. It is informational data only and does not trade or submit transactions.

`POST /v1/agent-work-brief` costs `$0.03` and accepts optional `min_reward_usd`, `limit`, and `health_limit` filters. It is intended for agents deciding whether current work is worth pursuing; it makes no claims, payments, or downstream paid calls.

`POST /v1/read-page` costs `$0.01` and accepts `{ url, max_bytes?, timeout_ms? }`. It fetches a public http(s) page and returns clean Markdown (or plain text for non-HTML responses) with the document `title`, final URL after redirects, status, content type, byte counts, and a truncation flag. Local/private network targets are rejected (SSRF guard), and fetches are size- and time-bounded.

`POST /v1/x402-verify` costs `$0.005` and accepts `{ url, method?, body?, timeout_ms? }`. It probes any x402 endpoint from the buyer side — sends the unpaid request, decodes the 402 challenge, and returns the payment terms (`payTo`, price, scheme, network, x402 version) plus a verdict: `sellable`, `no_gate`, `plain_402`, `challenge_undecodable`, or `error_response`. It never pays.

`GET /.well-known/x402` (also available as `/.well-known/x402.json`) publishes the machine-readable service manifest, routes, prices, network, asset, and payout address. The manifest is generated from the request host so it remains correct when the zero-cost development tunnel rotates.

When the optional agent-tools hub gateway is enabled, it forwards settled requests to `/hub/v1/base-market-pulse` with a hub-issued `X-Hub-Secret`. That upstream path returns 404 without the secret and is separate from the direct x402 routes.

## MCP integration

The repository also includes a local stdio MCP server for Cline and other MCP clients:

```bash
npm run start:mcp
```

The `preflight_context` tool provides a free local tier up to 12,000 characters. Larger inputs return the paid HTTP endpoint and its x402 price. Set `PAID_ENDPOINT` to the currently deployed endpoint when launching the MCP server. See [`llms-install.md`](./llms-install.md) for a copy-paste client configuration.

The same server is available as a hosted, stateless Streamable HTTP MCP endpoint at `https://agent-context-api-proxy.agent-context-proxy.workers.dev/mcp` and is described by [`server.json`](./server.json). It is published in the [official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.dacode-dev%2Fagent-context-api) for client and downstream-directory discovery. This hosted route is intended for clients that can discover remote MCP servers; local execution remains available for self-hosting and offline preflight work. [`glama.json`](./glama.json) identifies the GitHub maintainer for directory indexing and ownership.

## Design notes

- `server.js` contains the Express app, x402 payment middleware, discovery metadata, and route wiring.
- `mcp-core.js` defines the shared MCP tool surface; `mcp-server.js` runs it over stdio and `/mcp` runs it over Streamable HTTP.
- `analysis.js` contains deterministic context analysis; `bounty-radar.js` contains source normalization and evidence policy.
- `payanagent-health.js` contains the bounded, read-only catalog collector and probe logic.
- `market-pulse.js` contains the bounded public market/RPC collectors and partial-source health output.
- `test/server.test.js` covers redaction, budgets, the health route, and funded/unfunded labeling; `test/payanagent-health.test.js` covers health classification and the no-payment probe contract.
- The API intentionally does not send submitted text to a third party; processing is local.
- This is an experiment. Revenue must be verified from settlement records, not inferred from 402 responses, requests, or directory listings.
