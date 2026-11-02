/**
 * Independently prepared expected answers for live evaluation.
 * `expect` is the verdict a careful human fact-checker would give.
 * For non-checkable inputs the expected verdict is UNVERIFIED and `reason`
 * lists acceptable reason codes.
 *
 * Date-relative cases are computed at runtime from the real clock.
 */
import type { ReasonCode, Verdict } from "../../src/lib/veritas/types";

export interface LiveCase {
  input: string;
  expect: Verdict;
  reason?: ReasonCode[];
  note?: string;
}

function dateCases(now: Date, timezone: string): LiveCase[] {
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "long", day: "numeric", year: "numeric" }).format(d);
  const elevenDaysAgo = new Date(now.getTime() - 11 * 86_400_000);
  return [
    { input: `Today's date is ${fmt(now)}.`, expect: "TRUE", note: "date (today)" },
    { input: `Today's date is ${fmt(elevenDaysAgo)}.`, expect: "FALSE", note: "date (11 days ago)" },
  ];
}

export function liveCases(now: Date, timezone: string): LiveCase[] {
  return [
    // Required scenarios
    { input: "George Washington was the first president of the United States.", expect: "TRUE" },
    { input: "Samsung is the company that makes MacBooks.", expect: "FALSE" },
    { input: "There is a leap year every year.", expect: "FALSE" },
    { input: "The Earth revolves around the Sun.", expect: "TRUE" },
    { input: "Humans have three hearts.", expect: "FALSE" },
    { input: "The capital of France is Paris.", expect: "TRUE" },
    ...dateCases(now, timezone),
    // Spelling / casual phrasing
    { input: "i'm pretty sure george washingtin was like the frist us presidnet", expect: "TRUE", note: "spelling + casual" },
    { input: "lol pretty sure the great wall of china is in japan", expect: "FALSE", note: "casual" },
    // More stable facts (held out from the UI examples)
    { input: "Water boils at 100 degrees Celsius at sea level.", expect: "TRUE" },
    { input: "Mount Everest is the tallest mountain above sea level.", expect: "TRUE" },
    { input: "The Pacific is the smallest ocean on Earth.", expect: "FALSE" },
    { input: "Spiders are insects.", expect: "FALSE" },
    { input: "The Declaration of Independence was signed in 1776.", expect: "TRUE" },
    { input: "Neil Armstrong was the first person to walk on the Moon.", expect: "TRUE" },
    { input: "Tokyo is the capital of China.", expect: "FALSE" },
    // Non-checkable inputs
    { input: "Pizza is the best food in the world.", expect: "UNVERIFIED", reason: ["OPINION"] },
    { input: "Will it rain in New York next Tuesday?", expect: "UNVERIFIED", reason: ["QUESTION", "PREDICTION"] },
    { input: "The Yankees will win the World Series in 2030.", expect: "UNVERIFIED", reason: ["PREDICTION"] },
    { input: "He was the first one to do it.", expect: "UNVERIFIED", reason: ["AMBIGUOUS", "NOT_A_CLAIM"] },
    // Insufficient evidence (invented)
    { input: "The Kelvarro Institute of Lunar Botany was founded in 1987 in Ohio.", expect: "UNVERIFIED", reason: ["NO_RESULTS", "INSUFFICIENT_EVIDENCE"] },
  ];
}
