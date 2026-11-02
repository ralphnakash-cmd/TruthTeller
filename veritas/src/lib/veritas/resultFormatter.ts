import type { AssessedSource, GateOutcome } from "./verdictEngine";
import type {
  ClaimResult,
  EvidenceRecord,
  EvidenceStrength,
  ParsedClaim,
  ProviderName,
  ReasonCode,
  SourceCitation,
  Verdict,
  VerificationReport,
} from "./types";

const STANCE_ORDER: Record<string, number> = { SUPPORTS: 0, CONTRADICTS: 0, INSUFFICIENT: 1, UNASSESSED: 2, IRRELEVANT: 3 };

/** Build citations strictly from retrieved records. Model text can only choose a stance and a verified quote. */
export function toCitations(sources: AssessedSource[], explanation: string): SourceCitation[] {
  const cited = new Set((explanation.match(/\bS\d{1,2}\b/g) ?? []).map((x) => x.toUpperCase()));
  return sources
    .map(({ record, stance, quote, quoteVerified, rationale }) => ({
      id: record.id,
      title: record.title,
      url: record.url,
      publisher: record.publisher,
      domain: record.domain,
      excerpt: quoteVerified && quote ? quote : record.excerpt.length > 320 ? record.excerpt.slice(0, 320).replace(/\s+\S*$/, "") + "…" : record.excerpt,
      excerptIsVerifiedQuote: Boolean(quoteVerified && quote),
      stance,
      rationale,
      tier: record.tier,
      tierReason: record.tierReason,
      publishedAt: record.publishedAt,
      retrievedAt: record.retrievedAt,
      provider: record.provider,
      independenceGroup: record.independenceGroup,
      cited: cited.has(record.id) && (stance === "SUPPORTS" || stance === "CONTRADICTS"),
    }))
    .sort((a, b) => (STANCE_ORDER[a.stance] ?? 9) - (STANCE_ORDER[b.stance] ?? 9) || Number(b.cited) - Number(a.cited));
}

interface Common {
  claim: ParsedClaim;
  verifiedAt: string;
  searchQueries?: string[];
  providersUsed?: ProviderName[];
  providerErrors?: string[];
  timings?: { searchMs: number; evaluateMs: number; totalMs: number };
}

function base(c: Common) {
  return {
    claimId: c.claim.id,
    originalClaim: c.claim.originalText,
    normalizedClaim: c.claim.normalizedClaim,
    category: c.claim.category,
    ambiguityNote: c.claim.ambiguityNote,
    searchQueries: c.searchQueries ?? [],
    providersUsed: c.providersUsed ?? [],
    providerErrors: c.providerErrors ?? [],
    timeSensitivity: c.claim.timeSensitivity,
    cached: false,
    verifiedAt: c.verifiedAt,
    timings: c.timings ?? { searchMs: 0, evaluateMs: 0, totalMs: 0 },
  };
}

export function fromGate(c: Common & { gate: GateOutcome; modelProposed: Verdict }): ClaimResult {
  return {
    ...base(c),
    verdict: c.gate.verdict,
    reasonCode: c.gate.reasonCode,
    evidenceStrength: c.gate.evidenceStrength,
    explanation: c.gate.explanation,
    gateNote: c.gate.gateNote,
    modelProposedVerdict: c.modelProposed,
    sources: toCitations(c.gate.sources, c.gate.explanation),
    stats: {
      sourcesConsidered: c.gate.sources.length,
      independentSupporting: c.gate.supportGroups,
      independentContradicting: c.gate.contradictGroups,
      supportWeight: c.gate.supportWeight,
      contradictWeight: c.gate.contradictWeight,
    },
  };
}

export function unverifiedResult(
  c: Common & { reasonCode: ReasonCode; explanation: string; records?: EvidenceRecord[]; strength?: EvidenceStrength },
): ClaimResult {
  const sources = (c.records ?? []).map((record) => ({
    record,
    stance: "UNASSESSED" as const,
    quote: null,
    quoteVerified: false,
    rationale: null,
  }));
  return {
    ...base(c),
    verdict: "UNVERIFIED",
    reasonCode: c.reasonCode,
    evidenceStrength: c.strength ?? "NONE",
    explanation: c.explanation,
    gateNote: null,
    modelProposedVerdict: null,
    sources: toCitations(sources, ""),
    stats: { sourcesConsidered: sources.length, independentSupporting: 0, independentContradicting: 0, supportWeight: 0, contradictWeight: 0 },
  };
}

export function clockResult(c: Common & { verdict: Verdict; explanation: string; evidence: EvidenceRecord }): ClaimResult {
  const stance = c.verdict === "TRUE" ? "SUPPORTS" : c.verdict === "FALSE" ? "CONTRADICTS" : "INSUFFICIENT";
  return {
    ...base(c),
    verdict: c.verdict,
    reasonCode: c.verdict === "TRUE" ? "SUPPORTED" : c.verdict === "FALSE" ? "CONTRADICTED" : "AMBIGUOUS",
    evidenceStrength: c.verdict === "UNVERIFIED" ? "NONE" : "STRONG",
    explanation: c.explanation,
    gateNote: null,
    modelProposedVerdict: null,
    sources: toCitations([{ record: c.evidence, stance, quote: c.evidence.excerpt, quoteVerified: true, rationale: "Checked against the runtime clock." }], "S1"),
    stats: {
      sourcesConsidered: 1,
      independentSupporting: stance === "SUPPORTS" ? 1 : 0,
      independentContradicting: stance === "CONTRADICTS" ? 1 : 0,
      supportWeight: stance === "SUPPORTS" ? 3 : 0,
      contradictWeight: stance === "CONTRADICTS" ? 3 : 0,
    },
  };
}

/** Plain-text rendering used for "Copy result". */
export function reportToText(report: VerificationReport): string {
  const lines: string[] = [`Veritas verification — ${new Date(report.verifiedAt).toLocaleString("en-US", { timeZone: report.timezone })} (${report.timezone})`];
  if (report.mode === "DEMO") lines.push("⚠ DEMO MODE — sample data, not a live verification.");
  lines.push(`Input: "${report.input}"`, "");
  for (const c of report.claims) {
    lines.push(`Claim: ${c.normalizedClaim}`);
    lines.push(`Verdict: ${c.verdict}${c.verdict === "UNVERIFIED" ? ` (${c.reasonCode})` : ""} · Evidence strength: ${c.evidenceStrength}`);
    lines.push(`Why: ${c.explanation}`);
    const relevant = c.sources.filter((s) => s.stance === "SUPPORTS" || s.stance === "CONTRADICTS");
    for (const s of relevant) lines.push(`  [${s.id}] ${s.stance} — ${s.publisher}: ${s.title}${s.url ? ` <${s.url}>` : ""}`);
    lines.push("");
  }
  lines.push(`Total time: ${(report.durationMs / 1000).toFixed(1)}s`);
  return lines.join("\n");
}
