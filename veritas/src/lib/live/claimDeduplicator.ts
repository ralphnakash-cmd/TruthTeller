import { jaccard, wordShingles } from "../veritas/util";

/**
 * Phase-2 building block for the live-listening pipeline.
 *
 *   mic → speech-to-text → transcript segments → claim detection
 *       → ClaimDeduplicator → verifyClaim() → live verdict feed
 *
 * In a conversation the same claim is often repeated or rephrased. This keeps
 * a sliding window of recently checked claims and suppresses near-duplicates
 * so we don't pay for (or flash) the same verdict twice.
 */
export class ClaimDeduplicator {
  private recent: Array<{ text: string; shingles: Set<string>; at: number }> = [];

  constructor(
    private windowMs = 5 * 60_000,
    private threshold = 0.6,
    private clock: () => number = Date.now,
  ) {}

  /** Returns true if this claim is new (and records it); false if it's a near-duplicate. */
  admit(normalizedClaim: string): boolean {
    const now = this.clock();
    this.recent = this.recent.filter((r) => now - r.at < this.windowMs);
    const text = normalizedClaim.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    const shingles = wordShingles(text, 2);
    const dup = this.recent.some((r) => r.text === text || jaccard(r.shingles, shingles) >= this.threshold);
    if (!dup) this.recent.push({ text, shingles, at: now });
    return !dup;
  }
}
