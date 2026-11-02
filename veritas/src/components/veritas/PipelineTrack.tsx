"use client";

import { Check, Loader2, Minus } from "lucide-react";
import { useEffect, useState } from "react";
import { type RunState, STAGES } from "@/lib/client/useVerification";
import { cn } from "@/lib/utils";
import { formatMs, STAGE_LABEL } from "./labels";

/** The four real pipeline stages. State and detail text come from server events only. */
export function PipelineTrack({ state }: { state: RunState }) {
  const [now, setNow] = useState(Date.now());
  const running = state.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [running]);

  const elapsed = running && state.startedAt ? now - state.startedAt : state.report?.durationMs ?? null;

  return (
    <section aria-label="Verification progress" aria-live="polite" className="rounded-2xl border border-rule-soft bg-ink-2/60 p-4 sm:p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-muted">{running ? "Verifying" : state.status === "error" ? "Stopped" : "Pipeline"}</h2>
        {elapsed !== null && <span className="text-sm tabular-nums text-faint">{formatMs(elapsed)}</span>}
      </div>
      <ol className="grid gap-3 sm:grid-cols-4 sm:gap-2">
        {STAGES.map((stage, i) => {
          const { state: st, detail } = state.stages[stage];
          return (
            <li key={stage} className="relative flex gap-3 sm:block">
              <div className="flex items-center gap-2 sm:mb-2">
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full border text-[11px] tabular-nums",
                    st === "done" && "border-ice/50 bg-ice/15 text-ice",
                    st === "active" && "border-ice text-ice",
                    st === "skipped" && "border-dashed border-rule text-faint",
                    st === "pending" && "border-rule text-faint",
                  )}
                >
                  {st === "done" ? <Check className="size-3.5" /> : st === "active" ? <Loader2 className="size-3.5 animate-spin" /> : st === "skipped" ? <Minus className="size-3.5" /> : i + 1}
                </span>
                <span className={cn("hidden h-px flex-1 sm:block", st === "done" ? "bg-ice/40" : "bg-rule")} aria-hidden />
              </div>
              <div className="min-w-0">
                <p className={cn("text-sm", st === "pending" || st === "skipped" ? "text-faint" : "text-fg")}>
                  {STAGE_LABEL[stage]}
                  {st === "skipped" && <span className="text-faint"> (skipped)</span>}
                </p>
                {detail && <p className="mt-0.5 text-xs leading-relaxed text-muted">{detail}</p>}
                {st === "active" && (
                  <div className="mt-2 h-0.5 overflow-hidden rounded bg-rule-soft" aria-hidden>
                    <div className="scanline h-full w-2/5 bg-gradient-to-r from-transparent via-ice to-transparent" />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
