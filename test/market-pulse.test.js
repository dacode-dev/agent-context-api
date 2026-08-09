import assert from "node:assert/strict";
import test from "node:test";
import { generateMarketPulse } from "../market-pulse.js";

test("generateMarketPulse combines public sources without credentials or writes", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("coinbase.com")) {
      return { ok: true, async json() { return { data: { amount: "2500.50", currency: "USD" } }; } };
    }
    if (url.includes("dexscreener.com")) {
      return { ok: true, async json() { return { pairs: [
        { chainId: "ethereum", liquidity: { usd: 999999 }, priceUsd: "1" },
        { chainId: "base", dexId: "aerodrome", pairAddress: "0xpair", priceUsd: "2499.9", liquidity: { usd: 42 }, volume: { h24: 10 }, priceChange: { h24: 1.2 }, baseToken: { symbol: "WETH" }, quoteToken: { symbol: "USDC" } },
      ] }; } };
    }
    const body = JSON.parse(options.body);
    return { ok: true, async json() { return { jsonrpc: "2.0", id: body.id, result: body.method === "eth_blockNumber" ? "0x1234" : "0x3b9aca00" }; } };
  };
  const report = await generateMarketPulse({ fetchImpl, now: Date.parse("2026-08-09T00:00:00Z") });
  assert.equal(report.generated_at, "2026-08-09T00:00:00.000Z");
  assert.deepEqual(report.summary, { sources_ok: 3, sources_total: 3, eth_usd: 2500.5, base_block_number: 4660, base_gas_price_gwei: 1 });
  assert.equal(report.sources.dexscreener.pair.dex_id, "aerodrome");
  assert.equal(calls.filter((call) => call.options.headers?.authorization).length, 0);
  assert.equal(calls.filter((call) => call.options.method === "POST").length, 2);
});

test("generateMarketPulse keeps partial source failures explicit", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("coinbase.com")) return { ok: false, status: 503 };
    return { ok: true, async json() { return url.includes("dexscreener.com") ? { pairs: [] } : { result: "0x1" }; } };
  };
  const report = await generateMarketPulse({ fetchImpl });
  assert.equal(report.sources.coinbase.ok, false);
  assert.equal(report.summary.sources_total, 3);
  assert.ok(report.summary.sources_ok <= 2);
});
