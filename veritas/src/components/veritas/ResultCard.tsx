"use client";

import { ChevronDown, CircleCheck, CircleHelp, CircleX, Clock, Database, ShieldAlert, Timer } from "lucide-react";
import { motion } from "motion/react";
import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { ClaimResult } from "@/lib/veritas/types";
import { cn } from "@/lib/utils";
import { EvidenceBalance } from "./EvidenceBalance";
import { formatMs, REASON_LABEL, VERDICT_STYLE } from "./labels";
import { SourceCard } from "./SourceCard";

const ICON = { TRUE: CircleCheck, FALSE: CircleX, UNVERIFIED: CircleHelp };

/** Render explanation text, turning [S1] references into links to the source cards. */
function Explanation({ text, anchorPrefix, ids }: { text: string; anchorPrefix: string; ids: Set<string> }) {
  const parts = text.split(/(\[S\d{1,2}(?:\s*,\s*S\d{1,2})*\])/g);
  return (
    <p className="font-serif text-lg leading-relaxed text-fg/95 sm:text-[19px]">
      {parts.map((part, i) => {
        const refs = part.match(/S\d{1,2}/g);
        if (!refs || !part.startsWith("[")) return <Fragment key={i}>{part}</Fragment>;
        return (
          <sup key={i} className="ml-0.5 space-x-0.5 font-sans">
            {refs.map((r) =>
              ids.has(r) ? (
                <a key={r} href={`#${anchorPrefix}-${r}`} className="rounded bg-ice/10 px-1 py-0.5 text-[10px] font-medium text-ice hover:bg-ice/20">
                  {r}
                </a>
              ) : null,
            )}
          </sup>
        );
      })}
    </p>
  );
}

export function ResultCard({ result, reportId, index, total }: { result: ClaimResult; reportId: string; index: number; total: number }) {
  const [showOthers, setShowOthers] = useState(false);
  const [showMethod, setShowMethod] = useState(false);
  const v = VERDICT_STYLE[result.verdict];
  const Icon = ICON[result.verdict];
  const anchorPrefix = `${reportId}-${result.claimId}`;
  const decisive = result.sources.filter((s) => s.stance === "SUPPORTS" || s.stance === "CONTRADICTS");
  const others = result.sources.filter((s) => !(s.stance === "SUPPORTS" || s.stance === "CONTRADICTS"));
  const ids = new Set(result.sources.map((s) => s.id));
  const showOriginal = result.originalClaim.trim().toLowerCase().replace(/[^a-z0-9]/g, "") !== result.normalizedClaim.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const checkable = !["OPINION", "PREDICTION", "QUESTION", "AMBIGUOUS", "NOT_A_CLAIM"].includes(result.reasonCode);

  return (
    <article className={cn("relative overflow-hidden rounded-2xl border border-rule bg-panel/70", v.glow)} aria-label={`Claim ${index + 1}: ${result.verdict}`}>
      <span className={cn("absolute inset-y-0 left-0 w-1", v.rule)} aria-hidden />
      <div className="p-5 pl-6 sm:p-7 sm:pl-8">
        {total > 1 && <p className="mb-3 text-xs text-faint">Claim {index + 1} of {total}</p>}

        <motion.div
          className="flex flex-wrap items-center gap-x-4 gap-y-2"
          initial={{ opacity: 0, scale: 1.06 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <Icon className={cn("size-9 sm:size-10", v.text)} strokeWidth={1.75} aria-hidden />
          <h3 className={cn("text-[44px] leading-none font-semibold tracking-[-0.03em] sm:text-[56px]", v.text)}>{v.word}</h3>
          {result.verdict === "UNVERIFIED" && <Badge tone="unverified">{REASON_LABEL[result.reasonCode]}</Badge>}
        </motion.div>

        <blockquote className="mt-5 font-serif text-2xl leading-snug text-fg italic sm:text-[26px]">“{result.normalizedClaim}”</blockquote>
        {showOriginal && <p className="mt-1.5 text-sm text-faint">You wrote: “{result.originalClaim}”</p>}

        <div className="mt-5 max-w-[68ch]">
          <Explanation text={result.explanation} anchorPrefix={anchorPrefix} ids={ids} />
        </div>

        {result.gateNote && (
          <div className="mt-4 flex gap-2.5 rounded-xl border border-unverified/25 bg-unverified/[0.06] p-3 text-sm text-fg/90">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-unverified" aria-hidden />
            <p>
              <span className="font-medium">Verdict held back by the evidence check.</span> {result.gateNote}
            </p>
          </div>
        )}
        {result.ambiguityNote && result.reasonCode !== "AMBIGUOUS" && <p className="mt-3 text-sm text-muted">Note: {result.ambiguityNote}</p>}

        {checkable && result.stats.sourcesConsidered > 0 && (
          <div className="mt-6">
            <EvidenceBalance result={result} />
          </div>
        )}

        <dl className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
          <div className="flex items-center gap-1.5">
            <Clock className="size-3.5 text-faint" aria-hidden />
            <dt className="sr-only">Verified at</dt>
            <dd>{new Date(result.verifiedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <Timer className="size-3.5 text-faint" aria-hidden />
            <dt className="sr-only">Processing time</dt>
            <dd>{formatMs(result.timings.totalMs)}</dd>
          </div>
          {result.cached && (
            <div className="flex items-center gap-1.5">
              <Database className="size-3.5 text-faint" aria-hidden />
              <dd>Reused a recent verification</dd>
            </div>
          )}
        </dl>

        {decisive.length > 0 && (
          <section className="mt-6">
            <h4 className="mb-3 text-sm font-medium text-fg">Evidence</h4>
            <div className="grid gap-3 md:grid-cols-2">
              {decisive.map((s) => (
                <SourceCard key={s.id} source={s} anchorPrefix={anchorPrefix} />
              ))}
            </div>
          </section>
        )}

        {others.length > 0 && (
          <section className="mt-4">
            <button
              type="button"
              onClick={() => setShowOthers((x) => !x)}
              aria-expanded={showOthers}
              className="flex items-center gap-1.5 text-sm text-muted hover:text-fg"
            >
              <ChevronDown className={cn("size-4 transition-transform", showOthers && "rotate-180")} aria-hidden />
              {decisive.length > 0 ? `${others.length} other source${others.length === 1 ? "" : "s"} reviewed` : `${others.length} source${others.length === 1 ? "" : "s"} reviewed`}
            </button>
            {showOthers && (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {others.map((s) => (
                  <SourceCard key={s.id} source={s} anchorPrefix={anchorPrefix} />
                ))}
              </div>
            )}
          </section>
        )}

        {(result.searchQueries.length > 0 || result.providerErrors.length > 0) && (
          <section className="mt-4 border-t border-rule-soft pt-4">
            <button
              type="button"
              onClick={() => setShowMethod((x) => !x)}
              aria-expanded={showMethod}
              className="flex items-center gap-1.5 text-sm text-muted hover:text-fg"
            >
              <ChevronDown className={cn("size-4 transition-transform", showMethod && "rotate-180")} aria-hidden />
              How this was checked
            </button>
            {showMethod && (
              <div className="mt-3 grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-xs text-faint">Searches run</p>
                  <ul className="space-y-1">
                    {result.searchQueries.map((q) => (
                      <li key={q} className="font-mono text-xs text-fg/85">
                        {q}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 mb-1 text-xs text-faint">Providers that answered</p>
                  <p className="text-xs text-fg/85">{result.providersUsed.join(", ") || "none"}</p>
                  {result.providerErrors.length > 0 && (
                    <>
                      <p className="mt-3 mb-1 text-xs text-faint">Provider errors</p>
                      <ul className="space-y-1 text-xs text-false/90">
                        {result.providerErrors.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
                <div>
                  <p className="mb-1.5 text-xs text-faint">Timings</p>
                  <table className="w-full text-xs">
                    <tbody className="[&_td]:py-0.5">
                      <tr>
                        <td className="text-muted">Evidence search</td>
                        <td className="text-right tabular-nums">{formatMs(result.timings.searchMs)}</td>
                      </tr>
                      <tr>
                        <td className="text-muted">Evidence evaluation (LLM)</td>
                        <td className="text-right tabular-nums">{formatMs(result.timings.evaluateMs)}</td>
                      </tr>
                      <tr>
                        <td className="text-muted">This claim, total</td>
                        <td className="text-right tabular-nums">{formatMs(result.timings.totalMs)}</td>
                      </tr>
                    </tbody>
                  </table>
                  {result.modelProposedVerdict && (
                    <p className="mt-3 text-xs text-muted">
                      Model proposed <span className="text-fg">{result.modelProposedVerdict}</span>; evidence check returned{" "}
                      <span className="text-fg">{result.verdict}</span>.
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </article>
  );
}
