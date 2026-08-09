import assert from "node:assert/strict";
import test from "node:test";
import { classifyProbe, generateHealthReport, probeOffer } from "../payanagent-health.js";

test("classifyProbe treats payment gates as alive", () => {
  assert.equal(classifyProbe(402), "alive");
  assert.equal(classifyProbe(204), "alive");
  assert.equal(classifyProbe(404), "4xx");
  assert.equal(classifyProbe(503), "5xx");
  assert.equal(classifyProbe(302), "dead");
});

test("probeOffer uses HEAD and falls back to OPTIONS without payment headers", async () => {
  const calls = [];
  const fetchImpl = async (_url, options) => {
    calls.push(options);
    return { status: calls.length === 1 ? 405 : 402 };
  };
  const result = await probeOffer({ id: "offer-1", endpoint: "https://seller.example/buy" }, { fetchImpl });
  assert.equal(result.status, "alive");
  assert.deepEqual(calls.map((call) => call.method), ["HEAD", "OPTIONS"]);
  assert.ok(calls.every((call) => !("headers" in call)));
});

test("generateHealthReport bounds catalog work and records zero paid calls", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("/api/v1/offers")) {
      return {
        ok: true,
        async json() {
          return {
            offers: [
              { id: "one", title: "One", endpoint: "https://one.example/buy" },
              { id: "two", title: "Two", endpoint: "https://two.example/buy" },
            ],
          };
        },
      };
    }
    return { status: 402 };
  };
  const report = await generateHealthReport({ limit: 999, fetchImpl, now: Date.parse("2026-08-09T00:00:00Z") });
  assert.equal(report.requested_limit, 25);
  assert.equal(report.checked, 2);
  assert.equal(report.paid_calls_made, 0);
  assert.equal(report.summary.alive, 2);
  assert.ok(calls.every(({ options }) => options.method === undefined || ["HEAD", "OPTIONS"].includes(options.method)));
});
