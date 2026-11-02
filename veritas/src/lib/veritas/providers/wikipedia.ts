import type { RawSearchResult } from "../types";
import { HttpError, fetchWithTimeout, withRetry } from "../util";
import type { SearchOptions, SearchProvider } from "./webSearchProvider";

/**
 * Wikipedia (free, no key). Uses the MediaWiki Action API with a search
 * generator and returns the plain-text lead section of the top articles.
 * Only ever talks to a fixed host — no user-controlled URLs are fetched.
 */
export class WikipediaProvider implements SearchProvider {
  readonly name = "wikipedia" as const;
  readonly role = "reference" as const;
  constructor(private opts: { timeoutMs: number; userAgent: string; fetchImpl?: typeof fetch; lang?: string }) {}

  async search(query: string, { limit, signal }: SearchOptions): Promise<RawSearchResult[]> {
    const host = `https://${this.opts.lang ?? "en"}.wikipedia.org/w/api.php`;
    const url = new URL(host);
    const params: Record<string, string> = {
      action: "query",
      format: "json",
      formatversion: "2",
      generator: "search",
      gsrsearch: query,
      gsrlimit: String(Math.min(limit, 3)),
      prop: "extracts|info",
      exintro: "1",
      explaintext: "1",
      exlimit: String(Math.min(limit, 3)),
      inprop: "url",
      redirects: "1",
    };
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const json = await withRetry(async () => {
      const res = await fetchWithTimeout(url.toString(), {
        timeoutMs: this.opts.timeoutMs,
        signal,
        fetchImpl: this.opts.fetchImpl,
        headers: { accept: "application/json", "user-agent": this.opts.userAgent, "api-user-agent": this.opts.userAgent },
      });
      if (!res.ok) throw new HttpError(res.status, `Wikipedia ${res.status}`);
      return res.json();
    }, 1);

    const pages: unknown[] = Array.isArray(json?.query?.pages) ? json.query.pages : [];
    return pages
      .map((p) => p as Record<string, unknown>)
      .filter((p) => typeof p.fullurl === "string" && typeof p.extract === "string" && (p.extract as string).length > 40)
      .sort((a, b) => Number(a.index ?? 99) - Number(b.index ?? 99))
      .map((p) => ({
        title: `${String(p.title)} — Wikipedia`,
        url: String(p.fullurl),
        content: String(p.extract),
        publishedAt: typeof p.touched === "string" ? p.touched : null,
        score: null,
        provider: "wikipedia" as const,
        query,
        publisherHint: "Wikipedia",
      }));
  }
}
