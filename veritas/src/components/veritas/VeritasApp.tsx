"use client";

import { Check, Copy, KeyRound, TriangleAlert } from "lucide-react";
import { MotionConfig } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { addToHistory, clearHistory, loadHistory, removeFromHistory } from "@/lib/client/history";
import { useVerification } from "@/lib/client/useVerification";
import type { ServiceStatus } from "@/lib/veritas/factory";
import { reportToText } from "@/lib/veritas/resultFormatter";
import type { VerificationReport } from "@/lib/veritas/types";
import { cn } from "@/lib/utils";
import { ClaimComposer } from "./ClaimComposer";
import { HistoryPanel } from "./HistoryPanel";
import { PipelineTrack } from "./PipelineTrack";
import { ResultCard } from "./ResultCard";

function Mark() {
  // A balance beam: the product weighs evidence on both sides.
  return (
    <svg viewBox="0 0 40 40" className="size-9" aria-hidden>
      <circle cx="20" cy="20" r="19" fill="none" stroke="var(--color-rule)" />
      <path d="M8 17 L32 14" stroke="var(--color-ice)" strokeWidth="2" strokeLinecap="round" />
      <path d="M20 15.5 L20 29 M15 29 H25" stroke="var(--color-fg)" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="17" r="2.4" fill="var(--color-true)" />
      <circle cx="32" cy="14" r="2.4" fill="var(--color-false)" />
    </svg>
  );
}

function StatusDots({ status }: { status: ServiceStatus | null }) {
  if (!status) return null;
  const items: Array<{ label: string; on: boolean; title: string }> = [
    { label: "Claude", on: status.llm.configured, title: status.llm.configured ? `Reasoning: ${status.llm.smartModel}` : "ANTHROPIC_API_KEY missing" },
    {
      label: status.webSearch === "brave" ? "Brave" : "Tavily",
      on: Boolean(status.webSearch),
      title: status.webSearch ? `Live web search via ${status.webSearch}` : "No web search key — Wikipedia only",
    },
    { label: "Wikipedia", on: status.wikipedia, title: "Free reference lookups" },
  ];
  if (status.factCheck) items.push({ label: "Fact Check API", on: true, title: "Google Fact Check Tools" });
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-label="Evidence sources">
      {status.demoMode && <li className="rounded-md border border-unverified/40 px-1.5 py-0.5 text-unverified">Demo mode</li>}
      {items.map((i) => (
        <li key={i.label} title={i.title} className="flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", i.on ? "bg-true" : "bg-faint")} />
          <span className={i.on ? "" : "text-faint line-through decoration-faint/60"}>{i.label}</span>
        </li>
      ))}
    </ul>
  );
}

export function VeritasApp() {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<VerificationReport[]>([]);
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setHistory(loadHistory());
    fetch("/api/health")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const onComplete = useCallback((r: VerificationReport) => setHistory(addToHistory(r)), []);
  const { state, run, show } = useVerification(onComplete);
  const report = state.report;
  const results = report?.claims ?? [...state.partialResults].sort((a, b) => a.claimId.localeCompare(b.claimId));
  const notConfigured = status && !status.llm.configured && !status.demoMode;

  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(reportToText(report));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto w-full max-w-6xl px-4 pt-8 pb-24 sm:px-6 sm:pt-12">
        <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="flex items-center gap-3.5">
            <Mark />
            <div>
              <h1 className="font-serif text-[40px] leading-none tracking-[-0.01em] text-fg sm:text-5xl">Veritas</h1>
              <p className="mt-1.5 text-sm text-muted">Real-time intelligence. Evidence-based truth.</p>
            </div>
          </div>
          <StatusDots status={status} />
        </header>

        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
          <main className="min-w-0 space-y-6">
            {notConfigured && (
              <div className="flex gap-3 rounded-2xl border border-unverified/30 bg-unverified/[0.06] p-4 text-sm">
                <KeyRound className="mt-0.5 size-4 shrink-0 text-unverified" aria-hidden />
                <div className="space-y-1 text-fg/90">
                  <p className="font-medium">Add API keys to start verifying</p>
                  <p className="text-muted">
                    Copy <code className="font-mono text-xs">.env.example</code> to <code className="font-mono text-xs">.env.local</code>, add{" "}
                    <code className="font-mono text-xs">ANTHROPIC_API_KEY</code> and <code className="font-mono text-xs">TAVILY_API_KEY</code>, then restart{" "}
                    <code className="font-mono text-xs">npm run dev</code>. To click around without keys, set <code className="font-mono text-xs">VERITAS_DEMO_MODE=true</code>.
                  </p>
                </div>
              </div>
            )}

            <ClaimComposer value={input} onChange={setInput} onSubmit={run} running={state.status === "running"} />

            {state.status !== "idle" && state.startedAt !== null && report?.mode !== "DEMO" && <PipelineTrack state={state} />}

            {state.status === "error" && state.error && (
              <div role="alert" className="flex gap-3 rounded-2xl border border-false/30 bg-false/[0.06] p-4 text-sm">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-false" aria-hidden />
                <div>
                  <p className="font-medium text-fg">Verification didn&apos;t finish</p>
                  <p className="mt-0.5 text-muted">{state.error.message}</p>
                </div>
              </div>
            )}

            {report && report.warnings.length > 0 && (
              <ul className="space-y-2">
                {report.warnings.map((w) => (
                  <li
                    key={w}
                    className={cn(
                      "rounded-xl border px-4 py-2.5 text-sm",
                      report.mode === "DEMO"
                        ? "border-unverified/50 bg-[repeating-linear-gradient(135deg,rgba(233,177,77,0.08)_0_10px,transparent_10px_20px)] font-medium text-unverified"
                        : "border-rule bg-ink-2/60 text-muted",
                    )}
                  >
                    {w}
                  </li>
                ))}
              </ul>
            )}

            {results.length > 0 && (
              <section aria-label="Results" className="space-y-5">
                {report && (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-muted">
                      {results.length === 1 ? "1 claim checked" : `${results.length} claims checked`} in{" "}
                      <span className="tabular-nums text-fg">{(report.durationMs / 1000).toFixed(1)} s</span>
                    </p>
                    <Button variant="outline" size="sm" onClick={copy}>
                      {copied ? <Check /> : <Copy />}
                      {copied ? "Copied" : "Copy result"}
                    </Button>
                  </div>
                )}
                {results.map((r, i) => (
                  <ResultCard key={`${report?.id ?? "live"}-${r.claimId}`} result={r} reportId={report?.id ?? "live"} index={i} total={report?.claims.length ?? state.claimPreview.length} />
                ))}
              </section>
            )}

            {state.status === "idle" && !notConfigured && (
              <p className="max-w-[62ch] text-sm leading-relaxed text-faint">
                Veritas splits your statement into individual claims, searches the web and Wikipedia for evidence, and only says True or False when
                independent, reliable sources back it up. Everything else is marked Unverified.
              </p>
            )}
          </main>

          <HistoryPanel
            items={history}
            activeId={report?.id ?? null}
            onOpen={(r) => {
              setInput(r.input);
              show(r);
            }}
            onRemove={(id) => setHistory(removeFromHistory(id))}
            onClear={() => setHistory(clearHistory())}
          />
        </div>
      </div>
    </MotionConfig>
  );
}
