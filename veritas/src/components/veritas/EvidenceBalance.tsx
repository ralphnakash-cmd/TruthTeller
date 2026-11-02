"use client";

import { motion } from "motion/react";
import type { ClaimResult } from "@/lib/veritas/types";
import { cn } from "@/lib/utils";
import { STRENGTH_LABEL } from "./labels";

const THRESHOLD = 2;

/**
 * Evidence balance: supporting weight grows left from the centre, contradicting
 * weight grows right. Weight = source tier, counted once per independent source.
 * The tick marks show the minimum weight the engine requires before it will say
 * TRUE or FALSE. Shown instead of an invented "confidence %".
 */
export function EvidenceBalance({ result }: { result: ClaimResult }) {
  const { supportWeight: sw, contradictWeight: cw, independentSupporting: ns, independentContradicting: nc } = result.stats;
  const max = Math.max(8, sw, cw);
  const pct = (w: number) => `${(w / max) * 50}%`;
  const strength = STRENGTH_LABEL[result.evidenceStrength];

  return (
    <div className="rounded-xl border border-rule-soft bg-ink/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex gap-0.5" aria-hidden>
            {[1, 2, 3].map((b) => (
              <span key={b} className={cn("h-3 w-1.5 rounded-sm", b <= strength.bars ? "bg-fg" : "bg-rule")} />
            ))}
          </span>
          <span className="text-sm font-medium text-fg">{strength.word}</span>
        </div>
        <span className="text-xs text-faint">{result.stats.sourcesConsidered} source{result.stats.sourcesConsidered === 1 ? "" : "s"} reviewed</span>
      </div>

      <div className="relative h-3 rounded-full bg-rule-soft" role="img" aria-label={`Supporting weight ${sw}, contradicting weight ${cw}. Minimum to decide: ${THRESHOLD}.`}>
        <motion.div
          className="absolute top-0 right-1/2 h-full rounded-l-full bg-true"
          initial={{ width: 0 }}
          animate={{ width: pct(sw) }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
        />
        <motion.div
          className="absolute top-0 left-1/2 h-full rounded-r-full bg-false"
          initial={{ width: 0 }}
          animate={{ width: pct(cw) }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
        />
        <span className="absolute -top-1 left-1/2 h-5 w-px -translate-x-1/2 bg-fg/70" aria-hidden />
        <span className="absolute -top-0.5 h-4 w-px bg-muted/60" style={{ right: `calc(50% + ${pct(THRESHOLD)})` }} aria-hidden />
        <span className="absolute -top-0.5 h-4 w-px bg-muted/60" style={{ left: `calc(50% + ${pct(THRESHOLD)})` }} aria-hidden />
      </div>

      <div className="mt-2.5 flex justify-between gap-4 text-xs">
        <span className="text-true">
          Supports <span className="tabular-nums">{sw}</span>
          <span className="text-faint"> from {ns} independent</span>
        </span>
        <span className="text-right text-false">
          Contradicts <span className="tabular-nums">{cw}</span>
          <span className="text-faint"> from {nc} independent</span>
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        Weight per independent source: primary or fact-checker 3, reference or news 2, general web 1, user-generated 0.5. Ticks mark the minimum of {THRESHOLD} needed for a verdict.
      </p>
    </div>
  );
}
