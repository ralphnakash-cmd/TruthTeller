import { TTLCache } from "./cache";
import { parseClaims } from "./claimParser";
import type { EngineConfig } from "./config";
import { retrieveEvidence } from "./evidenceRetriever";
import { assessCheckability } from "./factCheckabilityClassifier";
import type { LlmClient } from "./llm";
import type { SearchProvider } from "./providers/webSearchProvider";
import { clockResult, fromGate, unverifiedResult } from "./resultFormatter";
import { generateSearchQueries } from "./searchQueryGenerator";
import { checkClockClaim, localParts, resolveTimezone } from "./temporal";
import {
  type ClaimResult,
  type ParsedClaim,
  type RawSearchResult,
  type VerificationEvent,
  type VerificationReport,
  VeritasError,
} from "./types";
import { applyEvidenceGate, assessEvidence } from "./verdictEngine";
import { errorMessage, fnv1a, mapWithConcurrency, randomId } from "./util";

export interface EngineDeps {
  llm: LlmClient;
  providers: SearchProvider[];
  config: EngineConfig;
  resultCache?: TTLCache<ClaimResult>;
  searchCache?: TTLCache<RawSearchResult[]>;
  clock?: () => Date;
  warnings?: string[];
}

export interface VerifyOptions {
  timezone?: string;
  onEvent?: (e: VerificationEvent) => void;
  signal?: AbortSignal;
}

export function validateInput(raw: unknown, maxChars: number): string {
  if (typeof raw !== "string") throw new VeritasError("INPUT_INVALID", "Input must be text.");
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < 3) throw new VeritasError("INPUT_INVALID", "Enter a statement to verify.");
  if (text.length > maxChars) throw new VeritasError("INPUT_INVALID", `Statements are limited to ${maxChars} characters.`);
  return text;
}

/**
 * Entry point for free text (typed input today; a transcript segment tomorrow).
 * Splits the text into claims and verifies each independently.
 */
export async function verifyText(input: unknown, deps: EngineDeps, opts: VerifyOptions = {}): Promise<VerificationReport> {
  const started = Date.now();
  const emit = opts.onEvent ?? (() => {});
  const text = validateInput(input, deps.config.maxInputChars);
  const now = (deps.clock ?? (() => new Date()))();
  const timezone = resolveTimezone(opts.timezone);

  emit({ type: "stage", stage: "ANALYZING", status: "start", detail: "Extracting and classifying claims" });
  let claims: ParsedClaim[];
  let parseMs = 0;
  try {
    const parsed = await parseClaims(deps.llm, text, { now, timezone, maxClaims: deps.config.maxClaimsPerInput, signal: opts.signal });
    claims = parsed.claims;
    parseMs = parsed.ms;
  } catch (err) {
    emit({ type: "stage", stage: "ANALYZING", status: "done", detail: "Claim analysis failed" });
    const claim = fallbackClaim(text);
    const result = unverifiedResult({
      claim,
      verifiedAt: now.toISOString(),
      reasonCode: "LLM_FAILED",
      explanation: `The language model could not analyze this statement (${errorMessage(err).slice(0, 120)}). No verdict was produced.`,
    });
    emit({ type: "claim_result", result });
    return finish([result]);
  }

  if (claims.length === 0) {
    claims = [{ ...fallbackClaim(text), category: "NOT_A_CLAIM" }];
  }
  emit({ type: "stage", stage: "ANALYZING", status: "done", detail: `Found ${claims.length} proposition${claims.length === 1 ? "" : "s"}` });
  emit({ type: "claims", claims: claims.map(({ id, normalizedClaim, category }) => ({ id, normalizedClaim, category })) });

  const results = await mapWithConcurrency(claims, 3, (c) => verifyClaim(c, deps, { now, timezone, emit, signal: opts.signal }));
  return finish(results);

  function finish(results: ClaimResult[]): VerificationReport {
    const totalMs = Date.now() - started;
    const report: VerificationReport = {
      id: randomId("v_"),
      mode: "LIVE",
      input: text,
      timezone,
      verifiedAt: now.toISOString(),
      durationMs: totalMs,
      timings: { parseMs, claimsMs: Math.max(0, totalMs - parseMs), totalMs },
      claims: results,
      warnings: deps.warnings ?? [],
    };
    emit({ type: "result", report });
    return report;
  }
}

function fallbackClaim(text: string): ParsedClaim {
  return {
    id: "c1",
    originalText: text,
    normalizedClaim: text,
    category: "AMBIGUOUS",
    categoryReason: "",
    ambiguityNote: null,
    timeSensitivity: "NONE",
    clockAssertion: null,
    searchQueries: [],
    keyEntities: [],
  };
}

interface ClaimContext {
  now: Date;
  timezone: string;
  emit: (e: VerificationEvent) => void;
  signal?: AbortSignal;
}

/** Verify one already-extracted claim. Reusable by a streaming/live pipeline. */
export async function verifyClaim(claimIn: ParsedClaim, deps: EngineDeps, ctx: ClaimContext): Promise<ClaimResult> {
  const t0 = Date.now();
  const { emit, now, timezone } = ctx;
  const verifiedAt = now.toISOString();
  const decision = assessCheckability(claimIn);
  const claim: ParsedClaim = { ...claimIn, category: decision.category };
  const done = (r: ClaimResult) => {
    r.timings.totalMs = Date.now() - t0;
    emit({ type: "claim_result", result: r });
    return r;
  };

  if (!decision.checkable) {
    emit({ type: "stage", stage: "SEARCHING", status: "skipped", claimId: claim.id, detail: `Not fact-checkable (${decision.reasonCode}) — no search run` });
    return done(unverifiedResult({ claim, verifiedAt, reasonCode: decision.reasonCode!, explanation: decision.explanation! }));
  }

  if (claim.timeSensitivity === "CURRENT_CLOCK" && claim.clockAssertion) {
    emit({ type: "stage", stage: "SEARCHING", status: "skipped", claimId: claim.id, detail: "Date claim — checked against the live server clock instead of the web" });
    const r = checkClockClaim(claim.clockAssertion, now, timezone);
    emit({ type: "stage", stage: "EVALUATING", status: "done", claimId: claim.id, detail: `Compared with current date in ${timezone}` });
    return done(clockResult({ claim, verifiedAt, verdict: r.verdict ?? "UNVERIFIED", explanation: r.explanation, evidence: r.evidence }));
  }

  const cacheKey = `${fnv1a(claim.normalizedClaim.toLowerCase().replace(/[^a-z0-9 ]/g, ""))}|${claim.timeSensitivity === "TIME_SENSITIVE" ? timezone : ""}`;
  const hit = deps.resultCache?.get(cacheKey);
  if (hit) {
    emit({ type: "stage", stage: "SEARCHING", status: "skipped", claimId: claim.id, detail: `Reused a verification from ${new Date(hit.verifiedAt).toLocaleTimeString("en-US", { timeZone: timezone })} (cache)` });
    return done({ ...hit, claimId: claim.id, originalClaim: claim.originalText, cached: true, timings: { ...hit.timings } });
  }

  if (deps.providers.length === 0) {
    emit({ type: "stage", stage: "SEARCHING", status: "skipped", claimId: claim.id, detail: "No search provider configured" });
    return done(unverifiedResult({ claim, verifiedAt, reasonCode: "SEARCH_FAILED", explanation: "No evidence source is configured, so this claim can't be checked." }));
  }

  const queries = generateSearchQueries(claim, deps.config.maxQueriesPerClaim);
  emit({
    type: "stage",
    stage: "SEARCHING",
    status: "start",
    claimId: claim.id,
    detail: `${queries.length} quer${queries.length === 1 ? "y" : "ies"} → ${deps.providers.map((p) => p.name).join(", ")}`,
  });
  const retrieval = await retrieveEvidence(deps.providers, {
    queries,
    primaryQuery: claim.normalizedClaim,
    entities: claim.keyEntities,
    resultsPerQuery: deps.config.resultsPerQuery,
    maxSources: deps.config.maxSourcesPerClaim,
    maxExcerptChars: deps.config.maxExcerptChars,
    signal: ctx.signal,
    searchCache: deps.searchCache,
    searchCacheTtlMs: deps.config.searchCacheTtlMs,
    now: () => new Date(),
  });
  emit({
    type: "stage",
    stage: "SEARCHING",
    status: "done",
    claimId: claim.id,
    detail: `${retrieval.records.length} unique source${retrieval.records.length === 1 ? "" : "s"} from ${retrieval.rawResultCount} results${retrieval.callsFailed ? `, ${retrieval.callsFailed} of ${retrieval.callsAttempted} searches failed` : ""}`,
  });
  const common = {
    claim,
    verifiedAt,
    searchQueries: queries,
    providersUsed: retrieval.providersUsed,
    providerErrors: retrieval.providerErrors,
    timings: { searchMs: retrieval.ms, evaluateMs: 0, totalMs: 0 },
  };

  if (retrieval.callsAttempted > 0 && retrieval.callsFailed === retrieval.callsAttempted) {
    return done(unverifiedResult({ ...common, reasonCode: "SEARCH_FAILED", explanation: "Every evidence search failed (network or API error), so no verdict was produced." }));
  }
  if (retrieval.records.length === 0) {
    return done(unverifiedResult({ ...common, reasonCode: "NO_RESULTS", explanation: "The searches returned no usable sources for this claim, so it can't be verified." }));
  }

  emit({ type: "stage", stage: "EVALUATING", status: "start", claimId: claim.id, detail: `Comparing ${retrieval.records.length} sources against the claim` });
  let result: ClaimResult;
  try {
    const { assessment, ms } = await assessEvidence(deps.llm, claim.normalizedClaim, retrieval.records, {
      currentDate: localParts(now, timezone).long,
      signal: ctx.signal,
    });
    common.timings.evaluateMs = ms;
    const gate = applyEvidenceGate(retrieval.records, assessment, deps.config.minDecisiveWeight);
    emit({
      type: "stage",
      stage: "EVALUATING",
      status: "done",
      claimId: claim.id,
      detail: `${gate.supportGroups} supporting and ${gate.contradictGroups} contradicting independent sources`,
    });
    emit({ type: "stage", stage: "GENERATING", status: "start", claimId: claim.id });
    result = fromGate({ ...common, gate, modelProposed: assessment.verdict });
  } catch (err) {
    emit({ type: "stage", stage: "EVALUATING", status: "done", claimId: claim.id, detail: "Evidence evaluation failed" });
    return done(
      unverifiedResult({
        ...common,
        records: retrieval.records,
        reasonCode: "LLM_FAILED",
        explanation: `Sources were retrieved, but the evaluation step failed (${errorMessage(err).slice(0, 120)}). No verdict was produced.`,
      }),
    );
  }
  emit({ type: "stage", stage: "GENERATING", status: "done", claimId: claim.id, detail: result.verdict });

  const ttl = claim.timeSensitivity === "TIME_SENSITIVE" ? deps.config.cacheTtlTimeSensitiveMs : deps.config.cacheTtlStableMs;
  deps.resultCache?.set(cacheKey, result, ttl);
  return done(result);
}
