import { VeritasError } from "./types";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch with a hard timeout that also respects an outer abort signal. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs: number; fetchImpl?: typeof fetch },
): Promise<Response> {
  const { timeoutMs, fetchImpl = fetch, signal: outer, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new VeritasError("TIMEOUT", `Request timed out after ${timeoutMs}ms`)), timeoutMs);
  const onOuterAbort = () => ctrl.abort(outer?.reason);
  outer?.addEventListener("abort", onOuterAbort, { once: true });
  try {
    return await fetchImpl(url, { ...rest, signal: ctrl.signal });
  } catch (err) {
    if (ctrl.signal.aborted && ctrl.signal.reason instanceof VeritasError) throw ctrl.signal.reason;
    throw err;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onOuterAbort);
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === 429 || err.status === 529 || err.status >= 500;
  if (err instanceof VeritasError) return err.code === "TIMEOUT";
  // Network-level failures (TypeError from fetch) are retryable.
  return err instanceof TypeError;
}

/** Retries with exponential backoff + jitter on retryable errors only. */
export async function withRetry<T>(fn: () => Promise<T>, retries: number, baseDelayMs = 400): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetryable(err)) break;
      await sleep(baseDelayMs * 2 ** attempt + Math.random() * 150);
    }
  }
  throw lastErr;
}

/** Run async work over items with a concurrency cap; preserves order. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Sanitize untrusted web text: strip HTML tags, control characters and
 * collapse whitespace. This text is DATA and is never executed or followed.
 */
export function sanitizeText(input: string, maxChars: number): string {
  const text = String(input ?? "")
    .replace(/<[^>]{0,300}>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxChars ? text.slice(0, maxChars).replace(/\s+\S*$/, "") + "…" : text;
}

/** Normalization used when checking that a model-provided quote really appears in a source. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

/** True only for absolute http(s) URLs with a hostname — anything else is rejected. */
export function safeHttpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname || u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|ref_src$|igshid$)/i;

export function canonicalUrl(raw: string): string | null {
  const u = safeHttpUrl(raw);
  if (!u) return null;
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  let s = u.toString();
  if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
  return s;
}

export function hostOf(raw: string): string | null {
  const u = safeHttpUrl(raw);
  return u ? u.hostname.toLowerCase().replace(/^www\./, "") : null;
}

const SECOND_LEVEL = new Set(["co", "com", "gov", "ac", "org", "net", "edu", "nhs", "go", "or", "ne"]);

/** Approximate registrable domain (eTLD+1) without a public-suffix list. */
export function registrableDomain(host: string): string {
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  if (tld.length === 2 && SECOND_LEVEL.has(sld)) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}

export function wordShingles(text: string, size = 5): Set<string> {
  const words = normalizeForMatch(text).replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(" "));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Small non-cryptographic hash for cache keys and log correlation (never logs raw text). */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function randomId(prefix = ""): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
