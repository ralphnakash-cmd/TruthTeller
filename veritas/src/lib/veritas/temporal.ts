import type { ClockAssertion, EvidenceRecord, Verdict } from "./types";

/** Returns the timezone if the runtime recognises it, otherwise UTC. */
export function resolveTimezone(tz: string | undefined | null): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0);
    return tz;
  } catch {
    return "UTC";
  }
}

export function localParts(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const long = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);
  return { year: get("year"), month: get("month"), day: get("day"), weekday: get("weekday"), long };
}

/**
 * Claims about the current date are checked against the server clock at
 * request time in the user's timezone — never against a hard-coded date
 * and never by asking the model what day it is.
 */
export function checkClockClaim(
  assertion: ClockAssertion,
  now: Date,
  timezone: string,
): { verdict: Verdict | null; evidence: EvidenceRecord; explanation: string } {
  const p = localParts(now, timezone);
  const actual: Record<ClockAssertion["unit"], string> = {
    DATE: `${p.year}-${p.month}-${p.day}`,
    WEEKDAY: p.weekday.toLowerCase(),
    MONTH: p.month,
    YEAR: p.year,
  };
  let asserted = assertion.value.trim();
  let valid = true;
  if (assertion.unit === "DATE") {
    const d = new Date(`${asserted}T12:00:00Z`);
    // Round-trip check rejects impossible dates like 2026-02-30 (which JS would roll over).
    valid = /^\d{4}-\d{2}-\d{2}$/.test(asserted) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === asserted;
  }
  if (assertion.unit === "WEEKDAY") {
    asserted = asserted.toLowerCase();
    valid = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].includes(asserted);
  }
  if (assertion.unit === "MONTH") {
    asserted = asserted.padStart(2, "0");
    valid = /^(0[1-9]|1[0-2])$/.test(asserted);
  }
  if (assertion.unit === "YEAR") valid = /^\d{4}$/.test(asserted);

  const evidence: EvidenceRecord = {
    id: "S1",
    title: `Current date in ${timezone}`,
    url: null,
    publisher: "Veritas server clock",
    domain: null,
    excerpt: `At verification time (${now.toISOString()}), the date in ${timezone} is ${p.long}.`,
    publishedAt: null,
    retrievedAt: now.toISOString(),
    provider: "clock",
    query: null,
    tier: "PRIMARY",
    tierReason: "Runtime system clock (authoritative for the current date, assuming the server clock is synchronized)",
    independenceGroup: "clock",
  };

  if (!valid) {
    return { verdict: null, evidence, explanation: "The date asserted in the statement couldn't be interpreted unambiguously." };
  }
  const matches = asserted === actual[assertion.unit];
  const claimedLabel =
    assertion.unit === "DATE"
      ? new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }).format(
          new Date(`${asserted}T12:00:00Z`),
        )
      : assertion.value;
  return {
    verdict: matches ? "TRUE" : "FALSE",
    evidence,
    explanation: matches
      ? `Correct — it is ${p.long} in ${timezone}.`
      : `Incorrect — it is ${p.long} in ${timezone}, not ${claimedLabel}.`,
  };
}
