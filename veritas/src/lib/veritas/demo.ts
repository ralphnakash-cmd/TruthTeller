import { localParts, resolveTimezone } from "./temporal";
import type { ClaimResult, SourceCitation, VerificationReport } from "./types";
import { randomId } from "./util";

/**
 * DEMO MODE (VERITAS_DEMO_MODE=true): lets you click through the UI without API
 * keys. Every report is marked mode:"DEMO", every source is labelled as sample
 * data with no link, and nothing claims a search took place. Never used as a
 * fallback for live mode.
 */
const SAMPLES: Array<{ match: RegExp; normalized: string; verdict: "TRUE" | "FALSE"; explanation: string }> = [
  {
    match: /washington/i,
    normalized: "George Washington was the first president of the United States.",
    verdict: "TRUE",
    explanation: "Sample result: in live mode, presidential history sources would be retrieved and shown here.",
  },
  {
    match: /samsung.*mac ?book|mac ?book.*samsung/i,
    normalized: "Samsung is the company that makes MacBooks.",
    verdict: "FALSE",
    explanation: "Sample result: in live mode, official Apple product pages and other sources would be retrieved and shown here.",
  },
];

function demoSource(stance: "SUPPORTS" | "CONTRADICTS", now: string): SourceCitation {
  return {
    id: "S1",
    title: "Sample source (demo mode)",
    url: null,
    publisher: "Demo data — not retrieved",
    domain: null,
    excerpt: "This is placeholder text for UI testing. No web search was performed in demo mode.",
    excerptIsVerifiedQuote: false,
    stance,
    rationale: null,
    tier: "GENERAL",
    tierReason: "Demo placeholder",
    publishedAt: null,
    retrievedAt: now,
    provider: "clock",
    independenceGroup: "demo",
    cited: true,
  };
}

export function demoReport(input: string, timezone?: string): VerificationReport {
  const tz = resolveTimezone(timezone);
  const now = new Date();
  const iso = now.toISOString();
  const sample = SAMPLES.find((s) => s.match.test(input));
  const claim: ClaimResult = {
    claimId: "c1",
    originalClaim: input,
    normalizedClaim: sample?.normalized ?? input,
    category: "FACTUAL",
    verdict: sample?.verdict ?? "UNVERIFIED",
    reasonCode: sample ? (sample.verdict === "TRUE" ? "SUPPORTED" : "CONTRADICTED") : "INSUFFICIENT_EVIDENCE",
    evidenceStrength: sample ? "MODERATE" : "NONE",
    explanation:
      sample?.explanation ??
      `Demo mode only replays two sample claims. Add ANTHROPIC_API_KEY and TAVILY_API_KEY to .env.local for live verification. (Today in ${tz}: ${localParts(now, tz).long}.)`,
    gateNote: null,
    modelProposedVerdict: null,
    ambiguityNote: null,
    sources: sample ? [demoSource(sample.verdict === "TRUE" ? "SUPPORTS" : "CONTRADICTS", iso)] : [],
    stats: { sourcesConsidered: sample ? 1 : 0, independentSupporting: 0, independentContradicting: 0, supportWeight: 0, contradictWeight: 0 },
    searchQueries: [],
    providersUsed: [],
    providerErrors: [],
    timeSensitivity: "NONE",
    cached: false,
    verifiedAt: iso,
    timings: { searchMs: 0, evaluateMs: 0, totalMs: 0 },
  };
  return {
    id: randomId("demo_"),
    mode: "DEMO",
    input,
    timezone: tz,
    verifiedAt: iso,
    durationMs: 0,
    timings: { parseMs: 0, claimsMs: 0, totalMs: 0 },
    claims: [claim],
    warnings: ["DEMO MODE — sample data only. No search or AI analysis was performed."],
  };
}
