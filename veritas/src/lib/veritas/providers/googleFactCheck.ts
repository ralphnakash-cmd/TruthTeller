import type { RawSearchResult } from "../types";
import { HttpError, fetchWithTimeout, sanitizeText } from "../util";
import type { SearchOptions, SearchProvider } from "./webSearchProvider";

/**
 * Optional: Google Fact Check Tools API (ClaimReview data from fact-checking
 * organizations). Useful for viral/political claims that have already been
 * reviewed; usually empty for basic encyclopedic facts.
 */
export class GoogleFactCheckProvider implements SearchProvider {
  readonly name = "google_factcheck" as const;
  readonly role = "factcheck" as const;
  constructor(private opts: { apiKey: string; timeoutMs: number; fetchImpl?: typeof fetch }) {}

  async search(query: string, { limit, signal }: SearchOptions): Promise<RawSearchResult[]> {
    const url = new URL("https://factchecktools.googleapis.com/v1alpha1/claims:search");
    url.searchParams.set("query", query);
    url.searchParams.set("languageCode", "en");
    url.searchParams.set("pageSize", String(limit));
    url.searchParams.set("key", this.opts.apiKey);
    const res = await fetchWithTimeout(url.toString(), { timeoutMs: this.opts.timeoutMs, signal, fetchImpl: this.opts.fetchImpl });
    if (!res.ok) throw new HttpError(res.status, `Google Fact Check ${res.status}`);
    const json = await res.json();
    const claims: unknown[] = Array.isArray(json?.claims) ? json.claims : [];
    const out: RawSearchResult[] = [];
    for (const c of claims) {
      const claim = c as Record<string, unknown>;
      const reviews = Array.isArray(claim.claimReview) ? (claim.claimReview as Record<string, unknown>[]) : [];
      for (const r of reviews) {
        if (typeof r.url !== "string") continue;
        const publisher = (r.publisher ?? {}) as Record<string, unknown>;
        out.push({
          title: sanitizeText(String(r.title ?? `Fact check: ${claim.text ?? ""}`), 200),
          url: r.url,
          content: `Claim reviewed: "${sanitizeText(String(claim.text ?? ""), 300)}"${claim.claimant ? ` (claimant: ${sanitizeText(String(claim.claimant), 80)})` : ""}. Rating given by ${sanitizeText(String(publisher.name ?? "fact-checker"), 80)}: ${sanitizeText(String(r.textualRating ?? "unrated"), 120)}.`,
          publishedAt: typeof r.reviewDate === "string" ? r.reviewDate : null,
          score: null,
          provider: "google_factcheck",
          query,
          publisherHint: typeof publisher.name === "string" ? publisher.name : undefined,
        });
      }
    }
    return out.slice(0, limit);
  }
}
