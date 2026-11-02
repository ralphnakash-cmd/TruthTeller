import type { ClaimCategory, ParsedClaim, ReasonCode } from "./types";

export interface CheckabilityDecision {
  checkable: boolean;
  category: ClaimCategory;
  reasonCode: ReasonCode | null;
  explanation: string | null;
}

const QUESTION_START = /^(is|are|was|were|do|does|did|can|could|will|would|should|has|have|had|who|what|when|where|why|how|which)\b/i;
const FUTURE_MARKERS = /\b(will|is going to|are going to|gonna)\b.*\b(next|tomorrow|in \d{4}|someday|eventually|soon)\b/i;

/**
 * Deterministic guard-rails on top of the model's classification.
 * The model proposes a category; this module can only make a claim LESS
 * checkable (e.g. catch a question mislabelled as FACTUAL), never more.
 */
export function assessCheckability(claim: ParsedClaim): CheckabilityDecision {
  let category = claim.category;
  const text = claim.normalizedClaim.trim();
  const original = claim.originalText.trim();

  if (!text || text.split(/\s+/).length < 2) category = "NOT_A_CLAIM";
  else if (category === "FACTUAL" && (original.endsWith("?") || text.endsWith("?")) && QUESTION_START.test(original)) category = "QUESTION";
  else if (category === "FACTUAL" && FUTURE_MARKERS.test(text)) category = "PREDICTION";
  else if (category === "FACTUAL" && claim.timeSensitivity === "CURRENT_CLOCK" && !claim.clockAssertion) category = "AMBIGUOUS";

  switch (category) {
    case "FACTUAL":
      return { checkable: true, category, reasonCode: null, explanation: null };
    case "OPINION":
      return {
        checkable: false,
        category,
        reasonCode: "OPINION",
        explanation: "This is a matter of opinion or taste, so evidence can't make it true or false.",
      };
    case "PREDICTION":
      return {
        checkable: false,
        category,
        reasonCode: "PREDICTION",
        explanation: "This is a prediction about the future, which can't be verified against current evidence.",
      };
    case "QUESTION":
      return {
        checkable: false,
        category,
        reasonCode: "QUESTION",
        explanation: "This is a question rather than an assertion. Rephrase it as a statement to check it.",
      };
    case "AMBIGUOUS":
      return {
        checkable: false,
        category,
        reasonCode: "AMBIGUOUS",
        explanation:
          (claim.ambiguityNote ? `${claim.ambiguityNote} ` : "") +
          "Because the statement can reasonably be read more than one way, Veritas won't force a verdict.",
      };
    default:
      return {
        checkable: false,
        category: "NOT_A_CLAIM",
        reasonCode: "NOT_A_CLAIM",
        explanation: "No checkable factual assertion was found in this text.",
      };
  }
}
