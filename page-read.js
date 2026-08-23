// Page-read engine for the paid /v1/read-page route.
// Pure helpers are exported for tests; the fetch layer takes an injected fetch
// so tests can stub network I/O.

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /\.local$/i,
  /\.internal$/i,
];

export function isPublicHttpUrl(raw) {
  if (typeof raw !== "string") return false;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname;
  if (!host) return false;
  if (u.port && Number.isNaN(Number(u.port))) return false;
  return !BLOCKED_HOST_PATTERNS.some((re) => re.test(host));
}

export function htmlToMarkdown(html, maxChars = 200_000) {
  let t = String(html);
  // Drop non-content blocks wholesale.
  t = t.replace(/<script[\s\S]*?<\/script>/gi, "");
  t = t.replace(/<style[\s\S]*?<\/style>/gi, "");
  t = t.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  t = t.replace(/<!--[\s\S]*?-->/g, "");
  t = t.replace(/<(svg|iframe|form|input|button|select|nav|footer)[\s\S]*?<\/(?:svg|iframe|form|select|nav|footer)>/gi, "");

  // Headings.
  t = t.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_m, inner) => `\n\n# ${stripTags(inner).trim()}\n`);
  t = t.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_m, inner) => `\n\n## ${stripTags(inner).trim()}\n`);
  t = t.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_m, inner) => `\n\n### ${stripTags(inner).trim()}\n`);
  t = t.replace(/<h([4-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, lvl, inner) => `\n\n${"#".repeat(Number(lvl))} ${stripTags(inner).trim()}\n`);

  // Links become [text](href); images drop to their alt text.
  t = t.replace(/<img[^>]*alt=["']([^"']*)["'][^>]*>/gi, (_m, alt) => (alt ? ` ${alt} ` : " "));
  t = t.replace(/<img[^>]*>/gi, " ");
  t = t.replace(/<a[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => `[${stripTags(inner).trim()}](${href})`);

  // List items and breaks.
  t = t.replace(/<li[^>]*>/gi, "\n- ");
  t = t.replace(/<\/(ul|ol)>/gi, "\n");
  t = t.replace(/<br\s*\/?>/gi, "\n");

  // Paragraph-ish separators.
  t = t.replace(/<\/(p|div|section|article|header|hgroup|blockquote|tr|table)>/gi, "\n");
  t = t.replace(/<(p|div|section|article|blockquote|table|tr)[^>]*>/gi, "\n");

  const out = decodeEntities(stripTags(t))
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+/gm, "")
    .trim();
  return out.length > maxChars ? out.slice(0, maxChars) : out;
}

function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, " ");
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'");
}

// Extracts the document title, tolerating malformed markup.
export function extractTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html));
  if (!m) return undefined;
  return decodeEntities(stripTags(m[1])).replace(/\s+/g, " ").trim() || undefined;
}

const MAX_BYTES_DEFAULT = 400_000;

// Fetches a URL and returns either { kind: "markdown", ... } metadata plus the
// converted content, or { kind: "text" } for non-HTML textual responses.
export async function readPage(rawUrl, opts = {}) {
  const maxBytes = clampInt(opts.maxBytes ?? opts.max_bytes, 1_000, 1_000_000, MAX_BYTES_DEFAULT);
  const timeoutMs = clampInt(opts.timeoutMs, 500, 20_000, 12_000);
  if (!isPublicHttpUrl(rawUrl)) {
    return { ok: false, error: "url must be a public http(s) URL", code: "bad_url" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rawUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; agent-context-page-reader/1.0)",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
      },
    });
    const contentType = res.headers.get("content-type") || "";
    const buf = await res.arrayBuffer();
    const sliced = buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf;
    const body = new TextDecoder("utf-8", { fatal: false }).decode(sliced);
    const base = {
      requested_url: rawUrl,
      final_url: res.url || rawUrl,
      status: res.status,
      content_type: contentType,
      bytes_fetched: Math.min(buf.byteLength, maxBytes),
      total_bytes: buf.byteLength,
      truncated: buf.byteLength > maxBytes,
    };
    if (/text\/html|application\/xhtml/i.test(contentType) || /^\s*</.test(body)) {
      return { ...base, ok: true, kind: "markdown", title: extractTitle(body), markdown: htmlToMarkdown(body, maxBytes) };
    }
    if (/text\/|application\/(json|xml|javascript)/i.test(contentType)) {
      return { ...base, ok: true, kind: "text", text: body.slice(0, maxBytes) };
    }
    return { ...base, ok: false, error: `unsupported content type: ${contentType || "unknown"}`, code: "unsupported_type" };
  } catch (err) {
    const reason = err.name === "AbortError" ? `timeout after ${timeoutMs}ms` : err.message;
    return { ok: false, error: `fetch failed: ${reason}`, code: err.name === "AbortError" ? "timeout" : "fetch_error" };
  } finally {
    clearTimeout(timer);
  }
}

function clampInt(v, lo, hi, dflt) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}
