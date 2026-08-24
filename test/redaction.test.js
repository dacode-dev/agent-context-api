import assert from "node:assert/strict";
import test from "node:test";
import { redactSecrets } from "../analysis.js";

// Fixtures are assembled at runtime so no complete credential literal ever
// appears in this file (write-path sanitizers would otherwise neuter them).

test("redactSecrets catches extended token classes", () => {
  const cases = {
    "gitlab-pat": "glpat-" + "aB3x9k".repeat(5),
    "openai-project-key": "sk-proj-" + "aB3xY9kL2mNpQrStUvWx1234567890abcd",
    "sendgrid-key": "SG." + "a".repeat(22) + "." + "b".repeat(43),
    "twilio-api-key": "SK" + "a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5",
    "npm-token": "npm_" + "aB3xY9kL2mNpQrStUvWx1234567890ABCDEF",
    "huggingface-token": "hf_" + "aB3xY9kL2mNpQrStUvWxYz01",
    "vercel-token": "vercel_" + "a".repeat(40),
    "linear-api-key": "lin_api_" + "a".repeat(40),
  };
  for (const [cls, secret] of Object.entries(cases)) {
    const { content, count } = redactSecrets(`const k = "${secret}";`);
    assert.ok(count >= 1, `expected redaction of ${cls}`);
    assert.ok(!content.includes(secret), `expected ${cls} value gone`);
  }
});

test("redactSecrets redacts passwords embedded in connection URLs", () => {
  const mkUrl = (scheme, user, pass, host) => `${scheme}://${user}:${pass}@${host}`;
  const urls = [
    [mkUrl("postgres", "admin", "hunt" + "er2secret", "db.example.com:5432/prod"), "postgres"],
    [mkUrl("postgresql", "u", "s3cr" + "etpw", "localhost/db"), "postgresql"],
    [mkUrl("mongodb+srv", "bob", "p4ssw0" + "rd9x", "cluster0.abc12.mongodb.net/db"), "mongodb+srv"],
    [mkUrl("mysql", "root", "sup3rs" + "3cret", "127.0.0.1:3306/app"), "mysql"],
    [mkUrl("rediss", "cache", "f8J2m" + "K9q", "redis.internal:6379/0"), "rediss"],
  ];
  for (const [url, scheme] of urls) {
    const { content, count } = redactSecrets(`const url = "${url}";`);
    assert.ok(count >= 1, `expected redaction in: ${scheme}`);
    assert.ok(!content.includes(url), `full url should not survive: ${scheme}`);
    assert.ok(content.includes(`${scheme}://`), `scheme preserved: ${scheme}`);
  }
  // URLs without a password are untouched.
  const clean = redactSecrets("postgres://db.example.com:5432/prod");
  assert.equal(clean.count, 0);
});

test("redactSecrets leaves normal code untouched", () => {
  const code = "function add(a, b) {\n  return a + b;\n}\n";
  const { content, count } = redactSecrets(code);
  assert.equal(content, code);
  assert.equal(count, 0);
});

test("budgetForModel recognizes gpt-5 and grok windows (parity with llm-ctxpack)", async () => {
  const { budgetForModel } = await import("../analysis.js");
  assert.equal(budgetForModel("gpt-5"), Math.floor(400000 * 0.85));
  assert.equal(budgetForModel("grok-4"), Math.floor(256000 * 0.85));
  // ordering guard: gpt-5 must not fall through to the generic gpt rule
  assert.notEqual(budgetForModel("gpt-5"), Math.floor(128000 * 0.85));
});
