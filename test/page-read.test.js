import assert from "node:assert/strict";
import test from "node:test";
import { isPublicHttpUrl, htmlToMarkdown, readPage } from "../page-read.js";

// Fixtures assembled at runtime where they resemble credentials; here they are
// ordinary URLs/markup so literals are safe.

test("isPublicHttpUrl accepts public http(s) URLs", () => {
  for (const u of ["https://example.com", "http://example.com/a?b=c", "https://sub.domain.example.co.uk/x"]) {
    assert.equal(isPublicHttpUrl(u), true, u);
  }
});

test("isPublicHttpUrl rejects non-http schemes and private targets", () => {
  const bad = [
    "ftp://example.com",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "not a url",
    "",
    null,
    "http://localhost/x",
    "http://127.0.0.1/x",
    "http://10.0.0.5/x",
    "http://192.168.1.10/x",
    "http://169.254.169.254/latest/meta-data/",
    "http://172.16.0.1/x",
    "http://172.31.255.255/x",
    "http://db.internal/x",
    "http://printer.local/x",
  ];
  for (const u of bad) {
    assert.equal(isPublicHttpUrl(u), false, String(u));
  }
});

test("htmlToMarkdown converts headings, links, lists; drops scripts/styles", () => {
  const html = `<!doctype html><html><head><style>.x{color:red}</style><script>evil()</script></head>
<body><h1>Title</h1><p>Para with <a href="/x">a link</a> and <img src="i.png" alt="an image">.</p>
<ul><li>one</li><li>two</li></ul><script>more()</script></body></html>`;
  const md = htmlToMarkdown(html);
  assert.match(md, /# Title/);
  assert.match(md, /\[a link\]\(\/x\)/);
  assert.match(md, /- one\n- two/s);
  assert.ok(!md.includes("evil()"), "scripts dropped");
  assert.ok(!md.includes("color:red"), "styles dropped");
  assert.match(md, /an image/, "image alt kept");
});

test("htmlToMarkdown truncates to maxChars", () => {
  const html = `<p>${"word ".repeat(100000)}</p>`;
  const md = htmlToMarkdown(html, 500);
  assert.ok(md.length <= 500 + 20); // small slack for trailing normalization
});

test("readPage rejects private/local URLs before any network I/O", async () => {
  const result = await readPage("http://169.254.169.254/latest/meta-data/");
  assert.equal(result.ok, false);
  assert.equal(result.code, "bad_url");
});

test("readPage clamps bounds and reports truncation (stubbed fetch)", async () => {
  const big = "<html><body>" + "x".repeat(300000) + "</body></html>";
  const fake = async () => new Response(big, { status: 200, headers: { "content-type": "text/html" } });
  const r = await readPage("https://example.com/big", { maxBytes: 50000 });
  // real fetch would hit network; instead verify the clamp helper path via direct call with injected fetch:
  void fake;
  // readPage uses global fetch; emulate by monkey-patching
  const g = globalThis;
  const origFetch = g.fetch;
  g.fetch = fake;
  try {
    const res = await readPage("https://example.com/big", { max_bytes: 50000 });
    assert.equal(res.ok, true);
    assert.equal(res.truncated, true);
    assert.equal(res.bytes_fetched, 50000);
  } finally {
    g.fetch = origFetch;
  }
});
