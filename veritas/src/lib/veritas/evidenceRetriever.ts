import type { SearchProvider } from "./providers/webSearchProvider";
import { assessSource, assignIndependenceGroups, TIER_WEIGHT } from "./sourceEvaluator";
import type { TTLCache } from "./cache";
import type { EvidenceRecord, ProviderName, RawSearchResult } from "./types";
import { canonicalUrl, errorMessage, hostOf, sanitizeText } from "./util";

export interface RetrievalResult {
  records: EvidenceRecord[];
  providersUsed: ProviderName[];
  providerErrors: string[];
  callsAttempted: number;
  callsFailed: number;
  rawResultCount: number;
  ms: number;
}

export interface RetrievalOptions {
  queries: string[];
  primaryQuery: string;
  entities: string[];
  resultsPerQuery: number;
  maxSources: number;
  maxExcerptChars: number;
  signal?: AbortSignal;
  searchCache?: TTLCache<RawSearchResult[]>;
  searchCacheTtlMs?: number;
  now?: () => Date;
}

/**
 * Runs searches concurrently across providers, then canonicalizes, de-duplicates,
 * sanitizes and tiers the results. Only the provider APIs' fixed hosts are
 * contacted — result URLs are never fetched server-side (no SSRF surface).
 */
export async function retrieveEvidence(providers: SearchProvider[], opts: RetrievalOptions): Promise<RetrievalResult> {
  const started = Date.now();
  const tasks: Array<{ provider: SearchProvider; query: string }> = [];
  for (const p of providers) {
    if (p.role === "web") for (const q of opts.queries) tasks.push({ provider: p, query: q });
    else tasks.push({ provider: p, query: p.role === "factcheck" ? opts.primaryQuery : opts.queries[0] ?? opts.primaryQuery });
  }

  const settled = await Promise.allSettled(
    tasks.map(async ({ provider, query }) => {
      const key = `${provider.name}::${query.toLowerCase()}`;
      const hit = opts.searchCache?.get(key);
      if (hit) return hit;
      const res = await provider.search(query, { limit: opts.resultsPerQuery, signal: opts.signal });
      opts.searchCache?.set(key, res, opts.searchCacheTtlMs ?? 3600_000);
      return res;
    }),
  );

  const providerErrors: string[] = [];
  const used = new Set<ProviderName>();
  const raw: RawSearchResult[] = [];
  let failed = 0;
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") {
      used.add(tasks[i].provider.name);
      raw.push(...s.value);
    } else {
      failed++;
      providerErrors.push(`${tasks[i].provider.name}: ${errorMessage(s.reason).slice(0, 160)}`);
    }
  });

  const retrievedAt = (opts.now?.() ?? new Date()).toISOString();
  const byUrl = new Map<string, Omit<EvidenceRecord, "id" | "independenceGroup">>();
  for (const r of raw) {
    const canon = canonicalUrl(r.url);
    const host = hostOf(r.url);
    if (!canon || !host) continue; // reject non-http(s) / malformed URLs
    const excerpt = sanitizeText(r.content, opts.maxExcerptChars);
    if (excerpt.length < 20) continue;
    const { tier, tierReason, publisher } = assessSource(host, opts.entities, r.publisherHint);
    const prev = byUrl.get(canon);
    if (prev && prev.excerpt.length >= excerpt.length) continue;
    byUrl.set(canon, {
      title: r.title || publisher,
      url: canon,
      publisher,
      domain: host,
      excerpt,
      publishedAt: r.publishedAt,
      retrievedAt,
      provider: r.provider,
      query: r.query,
      tier,
      tierReason,
    });
  }

  // Prefer higher-tier sources, then keep provider order (stable sort).
  const ranked = [...byUrl.values()]
    .map((r, i) => ({ r, i }))
    .sort((a, b) => TIER_WEIGHT[b.r.tier] - TIER_WEIGHT[a.r.tier] || a.i - b.i)
    .slice(0, opts.maxSources)
    .map(({ r }) => r);

  const groups = assignIndependenceGroups(ranked);
  const records: EvidenceRecord[] = ranked.map((r, i) => ({ ...r, id: `S${i + 1}`, independenceGroup: groups[i] }));

  return {
    records,
    providersUsed: [...used],
    providerErrors,
    callsAttempted: tasks.length,
    callsFailed: failed,
    rawResultCount: raw.length,
    ms: Date.now() - started,
  };
}
