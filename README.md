# Agent Context API

A small paid API for coding agents that need a deterministic context preflight before sending repository text to an LLM. It counts GPT-family tokens, applies an optional model-aware budget, and redacts likely credentials.

It also exposes managed data experiments. `bounty-radar` normalizes live agent-work listings and preserves the difference between a canonical escrow signal and an ordinary venue listing. `payanagent-health` produces a fresh liveness snapshot of the ranked PayanAgent catalog. `base-market-pulse` combines fresh public ETH, DEX, and Base-network signals. The source code is public, but the paid value is operated aggregation, source health, bounded probing, and timestamped results that a buyer does not have to run.

## Local development

```bash
npm install
npm test
X402_FACILITATOR=https://facilitator.openx402.ai npm start
```

The service listens on `http://localhost:8787` by default. `GET /health` is free. `POST /v1/context-preflight` returns an x402 `402 Payment Required` response until the caller supplies a valid Base USDC payment.

## API example

```bash
curl -X POST http://localhost:8787/v1/context-preflight \
  -H 'content-type: application/json' \
  -d '{"text":"const token = \"sk-example\";","model":"claude-sonnet","token_budget":1000}'
```

The default price is `$0.005` per request. Set `PAY_TO` to change the public payout address and `X402_FACILITATOR` to select a compatible facilitator. Do not put private keys or facilitator credentials in this repository; the service does not need a signing key to receive payments.

## Managed bounty radar

`POST /v1/bounty-radar` costs `$0.01` through x402. Send filters such as:

```json
{"include_unverified":false,"min_reward_usd":0,"limit":20}
```

The response includes source health, deadlines, claim bonds, external-spend requirements, and a `payment_evidence` field. Only listings explicitly marked canonical and escrowed are labeled funded; other listings remain visible only when requested and are labeled unverified.

## PayanAgent catalog health

`POST /v1/payanagent-health` costs `$0.01` through x402. It accepts an optional `limit` from 1 to 25 and checks the ranked public catalog using only read-only `HEAD` requests (falling back to `OPTIONS` when required). HTTP 402 means that a live payment gate responded; the service never sends payment headers or calls paid routes. The response contains per-offer status, HTTP code, latency, summary counts, and `generated_at`.

## Base market pulse

`POST /v1/base-market-pulse` costs `$0.01` through x402 and accepts `{}`. It reads Coinbase's public ETH/USD spot endpoint, DEX Screener's public Base WETH/USDC pair feed, and public Base JSON-RPC methods for the current block and gas price. It returns per-source health, timestamped values, and partial results when one source is unavailable. It is informational data only and does not trade or submit transactions.

## MCP integration

The repository also includes a local stdio MCP server for Cline and other MCP clients:

```bash
npm run start:mcp
```

The `preflight_context` tool provides a free local tier up to 12,000 characters. Larger inputs return the paid HTTP endpoint and its x402 price. Set `PAID_ENDPOINT` to the currently deployed endpoint when launching the MCP server. See [`llms-install.md`](./llms-install.md) for a copy-paste client configuration.

## Design notes

- `server.js` contains the Express app, x402 payment middleware, discovery metadata, and route wiring.
- `analysis.js` contains deterministic context analysis; `bounty-radar.js` contains source normalization and evidence policy.
- `payanagent-health.js` contains the bounded, read-only catalog collector and probe logic.
- `market-pulse.js` contains the bounded public market/RPC collectors and partial-source health output.
- `test/server.test.js` covers redaction, budgets, the health route, and funded/unfunded labeling; `test/payanagent-health.test.js` covers health classification and the no-payment probe contract.
- The API intentionally does not send submitted text to a third party; processing is local.
- This is an experiment. Revenue must be verified from settlement records, not inferred from 402 responses, requests, or directory listings.
