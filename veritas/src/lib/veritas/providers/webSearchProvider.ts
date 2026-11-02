import type { ProviderName, RawSearchResult } from "../types";
import { HttpError, fetchWithTimeout, sanitizeText, withRetry } from "../util";

export interface SearchOptions {
  limit: number;
  signal?: AbortSignal;
}

export interface SearchProvider {
  readonly name: ProviderName;
  /** "web" providers run for every query; "reference" providers run for the primary query only. */
  readonly role: "web" | "reference" | "factcheck";
  search(query: string, opts: SearchOptions): Promise<RawSearchResult[]>;
}

interface HttpProviderOptions {
  apiKey: string;
  timeoutMs: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

/** Tavily: search API built for LLM agents; returns clean content snippets per result. */
export class TavilyProvider implements SearchProvider {
  readonly name = "tavily" as const;
  readonly role = "web" as const;
  constructor(private opts: HttpProviderOptions) {}

  async search(query: string, { limit, signal }: SearchOptions): Promise<RawSearchResult[]> {
    const json = await withRetry(async () => {
      const res = await fetchWithTimeout("https://api.tavily.com/search", {
        method: "POST",
        timeoutMs: this.opts.timeoutMs,
        signal,
        fetchImpl: this.opts.fetchImpl,
        headers: { "content-type": "application/json", authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify({
          query,
          search_depth: "basic",
          topic: "general",
          max_results: limit,
          include_answer: false, // never use a pre-digested answer as evidence
          include_raw_content: false,
          include_published_date: true,
        }),
      });
      if (!res.ok) throw new HttpError(res.status, `Tavily ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
      return res.json();
    }, this.opts.retries ?? 1);

    const results: unknown[] = Array.isArray(json?.results) ? json.results : [];
    return results.flatMap((r) => {
      const o = r as Record<string, unknown>;
      if (typeof o.url !== "string" || typeof o.content !== "string") return [];
      return [
        {
          title: sanitizeText(String(o.title ?? ""), 200),
          url: o.url,
          content: String(o.content),
          publishedAt: typeof o.published_date === "string" ? o.published_date : null,
          score: typeof o.score === "number" ? o.score : null,
          provider: "tavily" as const,
          query,
        },
      ];
    });
  }
}

/** Brave Search API: independent index; snippets via description + extra_snippets. */
export class BraveProvider implements SearchProvider {
  readonly name = "brave" as const;
  readonly role = "web" as const;
  constructor(private opts: HttpProviderOptions) {}

  async search(query: string, { limit, signal }: SearchOptions): Promise<RawSearchResult[]> {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(limit));
    url.searchParams.set("extra_snippets", "true");
    const json = await withRetry(async () => {
      const res = await fetchWithTimeout(url.toString(), {
        timeoutMs: this.opts.timeoutMs,
        signal,
        fetchImpl: this.opts.fetchImpl,
        headers: { accept: "application/json", "x-subscription-token": this.opts.apiKey },
      });
      if (!res.ok) throw new HttpError(res.status, `Brave ${res.status}`);
      return res.json();
    }, this.opts.retries ?? 1);

    const results: unknown[] = Array.isArray(json?.web?.results) ? json.web.results : [];
    return results.flatMap((r) => {
      const o = r as Record<string, unknown>;
      if (typeof o.url !== "string") return [];
      const extra = Array.isArray(o.extra_snippets) ? (o.extra_snippets as unknown[]).map(String).join(" … ") : "";
      return [
        {
          title: sanitizeText(String(o.title ?? ""), 200),
          url: o.url,
          content: [String(o.description ?? ""), extra].filter(Boolean).join(" … "),
          publishedAt: typeof o.page_age === "string" ? o.page_age : null,
          score: null,
          provider: "brave" as const,
          query,
        },
      ];
    });
  }
}
