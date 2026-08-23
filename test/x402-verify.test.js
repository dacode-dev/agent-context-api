import assert from "node:assert/strict";
import test from "node:test";
import { classifyChallenge, decodeChallenge, verifyEndpoint } from "../x402-verify.js";

test("classifyChallenge detects header and body-based challenges", () => {
  const a = classifyChallenge({ status: 402, headers: { "x-payment-required": "eyJ4NDAyVmVyc2lvbiI6Mn0=" }, bodyText: "" });
  assert.equal(a.is402, true);
  assert.equal(a.hasChallengeHeader, true);
  const b = classifyChallenge({ status: 402, headers: {}, bodyText: '{"error":"payment required","accepts":[...]}' });
  assert.equal(b.bodyExceptsPayment, true);
  const c = classifyChallenge({ status: 200, headers: {}, bodyText: "hello" });
  assert.equal(c.is402, false);
});

test("decodeChallenge parses a realistic v2 challenge", () => {
  // Assembled at runtime to keep the fixture compact; content mirrors the
  // documented x402 v2 response shape.
  const payload = {
    x402Version: 2,
    error: "X-PAYMENT header is required",
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        maxAmountRequired: "10000",
        resource: "https://example.com/v1/read-page",
        payTo: "0xc4e8021CdFf1a11946Ed16bd264f77D6B3C0C0e9",
        asset: { name: "USDC" },
      },
    ],
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  const d = decodeChallenge(b64);
  assert.equal(d.x402Version, 2);
  assert.equal(d.accepts.length, 1);
  assert.equal(d.accepts[0].scheme, "exact");
  assert.equal(d.accepts[0].price, "10000");
  assert.ok(d.accepts[0].payTo.startsWith("0x"));
});

test("decodeChallenge returns null on garbage", () => {
  assert.equal(decodeChallenge("not-base64-json!!"), null);
  assert.equal(decodeChallenge(Buffer.from("plain text").toString("base64")), null);
  assert.equal(decodeChallenge(""), null);
});

test("verifyEndpoint rejects bad urls before network I/O", async () => {
  for (const u of ["ftp://x", "not-a-url", ""]) {
    const r = await verifyEndpoint(u);
    assert.equal(r.ok, false);
    assert.equal(r.code, "bad_url");
  }
});

test("verifyEndpoint classifies a sellable endpoint (stubbed fetch)", async () => {
  const challenge = Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepts: [{ scheme: "exact", network: "eip155:8453", maxAmountRequired: "10000", payTo: "0xabc" }],
    })
  ).toString("base64");
  const g = globalThis;
  const orig = g.fetch;
  g.fetch = async () =>
    new Response("{}", {
      status: 402,
      headers: { "x-payment-required": challenge },
    });
  try {
    const r = await verifyEndpoint("https://seller.example/v1/thing");
    assert.equal(r.ok, true);
    assert.equal(r.verdict, "sellable");
    assert.equal(r.challenge.accepts[0].price, "10000");
  } finally {
    g.fetch = orig;
  }
});

test("verifyEndpoint flags a success response as no_gate (stubbed fetch)", async () => {
  const g = globalThis;
  const orig = g.fetch;
  g.fetch = async () => new Response('{"ok":true}', { status: 200 });
  try {
    const r = await verifyEndpoint("https://free.example/api");
    assert.equal(r.verdict, "no_gate");
  } finally {
    g.fetch = orig;
  }
});
