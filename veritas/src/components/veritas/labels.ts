import type { EvidenceStrength, PipelineStage, ReasonCode, SourceTier, Stance, Verdict } from "@/lib/veritas/types";

export const VERDICT_STYLE: Record<Verdict, { text: string; rule: string; glow: string; tone: "true" | "false" | "unverified"; word: string }> = {
  TRUE: { text: "text-true", rule: "bg-true", glow: "shadow-[0_0_60px_-20px_rgba(67,209,151,0.55)]", tone: "true", word: "True" },
  FALSE: { text: "text-false", rule: "bg-false", glow: "shadow-[0_0_60px_-20px_rgba(242,100,111,0.55)]", tone: "false", word: "False" },
  UNVERIFIED: { text: "text-unverified", rule: "bg-unverified", glow: "shadow-[0_0_60px_-24px_rgba(233,177,77,0.45)]", tone: "unverified", word: "Unverified" },
};

export const REASON_LABEL: Record<ReasonCode, string> = {
  SUPPORTED: "Supported by evidence",
  CONTRADICTED: "Contradicted by evidence",
  OPINION: "Opinion",
  PREDICTION: "Prediction",
  QUESTION: "Question, not a claim",
  AMBIGUOUS: "Ambiguous",
  NOT_A_CLAIM: "No factual claim",
  INSUFFICIENT_EVIDENCE: "Not enough evidence",
  CONFLICTING_EVIDENCE: "Sources conflict",
  NO_RESULTS: "No sources found",
  SEARCH_FAILED: "Search unavailable",
  LLM_FAILED: "Analysis failed",
};

export const STRENGTH_LABEL: Record<EvidenceStrength, { word: string; bars: number }> = {
  STRONG: { word: "Strong evidence", bars: 3 },
  MODERATE: { word: "Moderate evidence", bars: 2 },
  LIMITED: { word: "Limited evidence", bars: 1 },
  NONE: { word: "No usable evidence", bars: 0 },
};

export const STAGE_LABEL: Record<PipelineStage, string> = {
  ANALYZING: "Analyzing claim",
  SEARCHING: "Searching sources",
  EVALUATING: "Evaluating evidence",
  GENERATING: "Generating verdict",
};

export const TIER_LABEL: Record<SourceTier, string> = {
  PRIMARY: "Primary",
  FACT_CHECK: "Fact-checker",
  REFERENCE: "Reference",
  NEWS: "News",
  GENERAL: "General web",
  LOW: "User-generated",
};

export const STANCE_LABEL: Record<Stance, { word: string; tone: "true" | "false" | "neutral" | "unverified" }> = {
  SUPPORTS: { word: "Supports", tone: "true" },
  CONTRADICTS: { word: "Contradicts", tone: "false" },
  INSUFFICIENT: { word: "Inconclusive", tone: "unverified" },
  IRRELEVANT: { word: "Not relevant", tone: "neutral" },
  UNASSESSED: { word: "Not assessed", tone: "neutral" },
};

export const EXAMPLES = [
  "Samsung makes MacBooks.",
  "George Washington was the first president of the United States.",
  "There is a leap year every year.",
  "Humans have three hearts.",
  "Today's date is October 1, 2026.",
  "i'm pretty sure the eiffel tower is in rome lol",
  "Paris is the capital of France and the Earth revolves around the Sun.",
  "Pineapple belongs on pizza.",
];

export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
