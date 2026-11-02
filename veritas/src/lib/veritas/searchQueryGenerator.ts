import type { ParsedClaim } from "./types";

/**
 * Turns the model-proposed queries into a small, safe, de-duplicated set.
 * Search operators and quotes are stripped (queries are data, not commands),
 * and the normalized claim is always available as a fallback so we never
 * depend only on the model's phrasing.
 */
export function generateSearchQueries(claim: ParsedClaim, maxQueries: number): string[] {
  const clean = (q: string) =>
    q
      .replace(/["“”]/g, "")
      .replace(/\b(site|inurl|intitle|filetype):\S+/gi, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);

  const out: string[] = [];
  const seen = new Set<string>();
  const add = (q: string) => {
    const c = clean(q);
    const key = c.toLowerCase().replace(/[^a-z0-9 ]/g, "");
    if (c.length >= 3 && !seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  };

  for (const q of claim.searchQueries) {
    if (out.length >= maxQueries) break;
    add(q);
  }
  if (out.length === 0) add(claim.normalizedClaim);
  return out.slice(0, Math.max(1, maxQueries));
}
