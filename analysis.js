import { encode } from "gpt-tokenizer";

const SECRET_PATTERNS = [
  { name: "aws-access-key-id", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { name: "gitlab-pat", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { name: "slack-token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,72}\b/g },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "stripe-key", re: /\b(?:sk|pk|rk)_live_[0-9a-zA-Z]{24,}\b/g },
  { name: "openai-key", re: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: "private-key-block", re: /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: "sendgrid-key", re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g },
  { name: "twilio-api-key", re: /\bSK[a-f0-9]{32}\b/g },
  { name: "npm-token", re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: "huggingface-token", re: /\bhf_[A-Za-z0-9]{20,}\b/g },
  { name: "vercel-token", re: /\bvercel_[A-Za-z0-9]{16,}\b/g },
  { name: "linear-api-key", re: /\blin_api_[A-Za-z0-9_]{20,}\b/g },
];

// Database/service connection URLs carrying an embedded password, e.g.
// postgres://user:secretpw@host:5432/db. The password segment is replaced;
// scheme, user, host, and path are preserved so the response stays readable.
const CONN_URL_RE =
  /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqps?|mssql):\/\/[^:\/\s"@]+:)([^@"\s]{6,})(@)/g;

const ENV_ASSIGNMENT_RE =
  /^(\s*[\w.]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY)[\w.]*\s*[:=]\s*['"]?)([^\s'"]{6,})(['"]?)/gim;

export function redactSecrets(content) {
  let redacted = content;
  let count = 0;
  for (const { name, re } of SECRET_PATTERNS) {
    redacted = redacted.replace(re, () => {
      count++;
      return `[REDACTED:${name}]`;
    });
  }
  redacted = redacted.replace(ENV_ASSIGNMENT_RE, (_match, prefix, _value, suffix) => {
    count++;
    return `${prefix}[REDACTED]${suffix}`;
  });
  // Connection URLs: keep scheme+user, drop the password.
  redacted = redacted.replace(CONN_URL_RE, (_m, pre, _pw, at) => {
    count++;
    return `${pre}[REDACTED]${at}`;
  });
  return { content: redacted, count };
}

export function countTokens(text) {
  return encode(text).length;
}

const MODEL_CONTEXT_WINDOWS = [
  [/claude.*(opus|sonnet|haiku)/i, 200000],
  [/claude/i, 200000],
  [/gpt-4o|gpt-4-turbo|gpt-4\.1/i, 128000],
  [/gpt-3\.5/i, 16000],
  [/gpt/i, 128000],
  [/gemini/i, 1000000],
  [/llama-3\.1|llama-3\.2|llama-3\.3/i, 128000],
  [/llama/i, 8000],
  [/mistral|mixtral/i, 128000],
  [/deepseek/i, 128000],
];

export function budgetForModel(name) {
  for (const [pattern, window] of MODEL_CONTEXT_WINDOWS) {
    if (pattern.test(name)) return Math.floor(window * 0.85);
  }
  return null;
}

export const MAX_INPUT_CHARS = 200_000;

export function analyzeContext({ text, model = null, tokenBudget = null, redact = true }) {
  if (typeof text !== "string") throw new Error("text must be a string");
  if (text.length > MAX_INPUT_CHARS) throw new Error(`text exceeds ${MAX_INPUT_CHARS} characters`);
  const result = redact ? redactSecrets(text) : { content: text, count: 0 };
  const tokens = countTokens(result.content);
  const modelBudget = model ? budgetForModel(model) : null;
  const effectiveBudget = Number.isInteger(tokenBudget) && tokenBudget > 0 ? tokenBudget : modelBudget;
  return {
    tokens,
    redacted_count: result.count,
    redacted_text: result.content,
    model,
    model_budget: modelBudget,
    requested_budget: tokenBudget,
    effective_budget: effectiveBudget,
    fits_budget: effectiveBudget === null ? null : tokens <= effectiveBudget,
    recommendation:
      effectiveBudget !== null && tokens > effectiveBudget
        ? "Reduce the context or raise the model budget before sending it."
        : "Context is within the requested budget.",
  };
}
