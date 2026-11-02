/** Engine limits and cost controls. All overridable via environment variables (server-side only). */

export interface EngineConfig {
  maxInputChars: number;
  maxClaimsPerInput: number;
  maxQueriesPerClaim: number;
  resultsPerQuery: number;
  maxSourcesPerClaim: number;
  maxExcerptChars: number;
  searchTimeoutMs: number;
  llmTimeoutMs: number;
  llmRetries: number;
  /** Minimum independent evidence weight required to return TRUE or FALSE. */
  minDecisiveWeight: number;
  cacheTtlStableMs: number;
  cacheTtlTimeSensitiveMs: number;
  searchCacheTtlMs: number;
}

function num(name: string, fallback: number): number {
  const raw = typeof process !== "undefined" ? process.env?.[name] : undefined;
  const v = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function loadEngineConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    maxInputChars: num("VERITAS_MAX_INPUT_CHARS", 600),
    maxClaimsPerInput: num("VERITAS_MAX_CLAIMS", 4),
    maxQueriesPerClaim: num("VERITAS_MAX_QUERIES", 3),
    resultsPerQuery: num("VERITAS_RESULTS_PER_QUERY", 5),
    maxSourcesPerClaim: num("VERITAS_MAX_SOURCES", 8),
    maxExcerptChars: 1200,
    searchTimeoutMs: num("VERITAS_SEARCH_TIMEOUT_MS", 8000),
    llmTimeoutMs: num("VERITAS_LLM_TIMEOUT_MS", 30000),
    llmRetries: 2,
    minDecisiveWeight: 2,
    cacheTtlStableMs: num("VERITAS_CACHE_TTL_MS", 6 * 60 * 60 * 1000),
    cacheTtlTimeSensitiveMs: 10 * 60 * 1000,
    searchCacheTtlMs: 60 * 60 * 1000,
    ...overrides,
  };
}
