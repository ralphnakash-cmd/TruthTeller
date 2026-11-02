/**
 * Veritas — core types for the verification engine.
 *
 * The engine is framework-agnostic: nothing in src/lib/veritas imports React,
 * Next.js, or browser APIs, so the same engine can be driven by the text form
 * today and by a streaming speech-to-text pipeline later.
 */

export type Verdict = "TRUE" | "FALSE" | "UNVERIFIED";

/** Why a verdict was reached. UNVERIFIED always carries a non-SUPPORTED/CONTRADICTED code. */
export type ReasonCode =
  | "SUPPORTED"
  | "CONTRADICTED"
  | "OPINION"
  | "PREDICTION"
  | "QUESTION"
  | "AMBIGUOUS"
  | "NOT_A_CLAIM"
  | "INSUFFICIENT_EVIDENCE"
  | "CONFLICTING_EVIDENCE"
  | "NO_RESULTS"
  | "SEARCH_FAILED"
  | "LLM_FAILED";

export type EvidenceStrength = "STRONG" | "MODERATE" | "LIMITED" | "NONE";

export type Stance = "SUPPORTS" | "CONTRADICTS" | "IRRELEVANT" | "INSUFFICIENT" | "UNASSESSED";

export type SourceTier = "PRIMARY" | "FACT_CHECK" | "REFERENCE" | "NEWS" | "GENERAL" | "LOW";

export type ClaimCategory =
  | "FACTUAL"
  | "OPINION"
  | "PREDICTION"
  | "QUESTION"
  | "AMBIGUOUS"
  | "NOT_A_CLAIM";

export type TimeSensitivity = "NONE" | "TIME_SENSITIVE" | "CURRENT_CLOCK";

export type ClockUnit = "DATE" | "WEEKDAY" | "MONTH" | "YEAR";

export interface ClockAssertion {
  unit: ClockUnit;
  /** DATE: YYYY-MM-DD, WEEKDAY: Monday…Sunday, MONTH: 01…12, YEAR: YYYY */
  value: string;
}

/** Output of claim extraction + normalization (one per proposition). */
export interface ParsedClaim {
  id: string;
  originalText: string;
  normalizedClaim: string;
  category: ClaimCategory;
  categoryReason: string;
  ambiguityNote: string | null;
  timeSensitivity: TimeSensitivity;
  clockAssertion: ClockAssertion | null;
  searchQueries: string[];
  keyEntities: string[];
}

export type ProviderName = "tavily" | "brave" | "wikipedia" | "google_factcheck" | "clock";

/** A single search hit as returned by a provider, before evaluation. */
export interface RawSearchResult {
  title: string;
  url: string;
  content: string;
  publishedAt: string | null;
  score: number | null;
  provider: ProviderName;
  query: string;
  /** Provider-specific extra, e.g. fact-check rating. */
  publisherHint?: string;
}

/** A retrieved, sanitized, tiered piece of evidence. IDs are S1, S2, … per claim. */
export interface EvidenceRecord {
  id: string;
  title: string;
  url: string | null;
  publisher: string;
  domain: string | null;
  excerpt: string;
  publishedAt: string | null;
  retrievedAt: string;
  provider: ProviderName;
  query: string | null;
  tier: SourceTier;
  tierReason: string;
  /** Records sharing a group are NOT independent corroboration (same site or copied text). */
  independenceGroup: string;
}

/** What the UI shows per source. Built only from EvidenceRecords — never from LLM text. */
export interface SourceCitation {
  id: string;
  title: string;
  url: string | null;
  publisher: string;
  domain: string | null;
  /** A verified verbatim quote from the retrieved text when one exists, else the start of the excerpt. */
  excerpt: string;
  excerptIsVerifiedQuote: boolean;
  stance: Stance;
  rationale: string | null;
  tier: SourceTier;
  tierReason: string;
  publishedAt: string | null;
  retrievedAt: string;
  provider: ProviderName;
  independenceGroup: string;
  cited: boolean;
}

export interface ClaimTimings {
  searchMs: number;
  evaluateMs: number;
  totalMs: number;
}

export interface ClaimResult {
  claimId: string;
  originalClaim: string;
  normalizedClaim: string;
  category: ClaimCategory;
  verdict: Verdict;
  reasonCode: ReasonCode;
  evidenceStrength: EvidenceStrength;
  explanation: string;
  /** Present when the deterministic gate overrode the model's proposed verdict. */
  gateNote: string | null;
  modelProposedVerdict: Verdict | null;
  ambiguityNote: string | null;
  sources: SourceCitation[];
  stats: {
    sourcesConsidered: number;
    independentSupporting: number;
    independentContradicting: number;
    supportWeight: number;
    contradictWeight: number;
  };
  searchQueries: string[];
  providersUsed: ProviderName[];
  providerErrors: string[];
  timeSensitivity: TimeSensitivity;
  cached: boolean;
  verifiedAt: string;
  timings: ClaimTimings;
}

export interface VerificationReport {
  id: string;
  mode: "LIVE" | "DEMO";
  input: string;
  timezone: string;
  verifiedAt: string;
  durationMs: number;
  timings: { parseMs: number; claimsMs: number; totalMs: number };
  claims: ClaimResult[];
  warnings: string[];
}

export type PipelineStage = "ANALYZING" | "SEARCHING" | "EVALUATING" | "GENERATING";

/** Progress events emitted by the engine. These are only emitted when the work actually happens. */
export type VerificationEvent =
  | { type: "stage"; stage: PipelineStage; status: "start" | "done" | "skipped"; claimId?: string; detail?: string }
  | { type: "claims"; claims: Array<Pick<ParsedClaim, "id" | "normalizedClaim" | "category">> }
  | { type: "claim_result"; result: ClaimResult }
  | { type: "result"; report: VerificationReport }
  | { type: "error"; code: string; message: string };

export class VeritasError extends Error {
  constructor(
    public code:
      | "INPUT_INVALID"
      | "NOT_CONFIGURED"
      | "LLM_FAILED"
      | "SEARCH_FAILED"
      | "TIMEOUT"
      | "RATE_LIMITED",
    message: string,
  ) {
    super(message);
    this.name = "VeritasError";
  }
}
