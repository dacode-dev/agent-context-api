const COINBASE_URL = "https://api.coinbase.com/v2/prices/ETH-USD/spot";
const BASE_WETH = "0x4200000000000000000000000000000000000006";
const DEXSCREENER_URL = `https://api.dexscreener.com/token-pairs/v1/base/${BASE_WETH}`;
const BASE_RPC_URL = "https://base-rpc.publicnode.com";
const REQUEST_TIMEOUT_MS = 5_000;

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hexToNumber(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) return null;
  const number = Number.parseInt(value, 16);
  return Number.isSafeInteger(number) ? number : null;
}

async function fetchJson(url, options = {}, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function readCoinbase(fetchImpl) {
  const body = await fetchJson(COINBASE_URL, { headers: { accept: "application/json" } }, fetchImpl);
  const amount = numberOrNull(body.data?.amount);
  if (amount === null) throw new Error("missing ETH spot price");
  return { ok: true, url: COINBASE_URL, price_usd: amount, currency: body.data?.currency || "USD" };
}

function choosePair(pairs) {
  return (pairs || [])
    .filter((pair) => pair.chainId === "base")
    .sort((a, b) => (numberOrNull(b.liquidity?.usd) || 0) - (numberOrNull(a.liquidity?.usd) || 0))[0] || null;
}

async function readDex(fetchImpl) {
  const body = await fetchJson(DEXSCREENER_URL, { headers: { accept: "application/json" } }, fetchImpl);
  const pair = choosePair(Array.isArray(body) ? body : body.pairs);
  if (!pair) throw new Error("no Base WETH/USDC pair found");
  return {
    ok: true,
    url: DEXSCREENER_URL,
    pair: {
      chain_id: pair.chainId,
      dex_id: pair.dexId || null,
      pair_address: pair.pairAddress || null,
      url: pair.url || null,
      base_symbol: pair.baseToken?.symbol || null,
      quote_symbol: pair.quoteToken?.symbol || null,
      price_usd: numberOrNull(pair.priceUsd),
      liquidity_usd: numberOrNull(pair.liquidity?.usd),
      volume_24h_usd: numberOrNull(pair.volume?.h24),
      price_change_24h_pct: numberOrNull(pair.priceChange?.h24),
      transactions_24h: pair.txns?.h24 || null,
    },
  };
}

async function rpcCall(method, id, fetchImpl) {
  const body = await fetchJson(BASE_RPC_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params: [], id }),
  }, fetchImpl);
  if (body.error) throw new Error(body.error.message || `${method} failed`);
  return body.result;
}

async function readBaseRpc(fetchImpl) {
  const [blockHex, gasHex] = await Promise.all([
    rpcCall("eth_blockNumber", 1, fetchImpl),
    rpcCall("eth_gasPrice", 2, fetchImpl),
  ]);
  const blockNumber = hexToNumber(blockHex);
  const gasPriceWei = hexToNumber(gasHex);
  if (blockNumber === null || gasPriceWei === null) throw new Error("invalid Base RPC result");
  return {
    ok: true,
    url: BASE_RPC_URL,
    block_number: blockNumber,
    gas_price_wei: gasPriceWei,
    gas_price_gwei: gasPriceWei / 1e9,
  };
}

async function safeSource(name, read) {
  try {
    return await read();
  } catch (error) {
    return { ok: false, source: name, error: error.message };
  }
}

export async function generateMarketPulse({ fetchImpl = fetch, now = Date.now() } = {}) {
  const [coinbase, dex, baseRpc] = await Promise.all([
    safeSource("coinbase", () => readCoinbase(fetchImpl)),
    safeSource("dexscreener", () => readDex(fetchImpl)),
    safeSource("base_rpc", () => readBaseRpc(fetchImpl)),
  ]);
  const sources = { coinbase, dexscreener: dex, base_rpc: baseRpc };
  const sourceValues = Object.values(sources);
  return {
    generated_at: new Date(now).toISOString(),
    product: "Base ETH and DEX market pulse",
    sources,
    summary: {
      sources_ok: sourceValues.filter((source) => source.ok).length,
      sources_total: sourceValues.length,
      eth_usd: coinbase.price_usd ?? dex.pair?.price_usd ?? null,
      base_block_number: baseRpc.block_number ?? null,
      base_gas_price_gwei: baseRpc.gas_price_gwei ?? null,
    },
    methodology: "Fresh public Coinbase spot, DEX Screener Base pair, and Base JSON-RPC snapshot. Informational data only; no trade or transaction is executed.",
  };
}
