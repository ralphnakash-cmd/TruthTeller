"use client";

import { useCallback, useRef, useState } from "react";
import type { ClaimResult, PipelineStage, VerificationEvent, VerificationReport } from "@/lib/veritas/types";

export type StageState = "pending" | "active" | "done" | "skipped";
export const STAGES: PipelineStage[] = ["ANALYZING", "SEARCHING", "EVALUATING", "GENERATING"];

export interface RunState {
  status: "idle" | "running" | "done" | "error";
  stages: Record<PipelineStage, { state: StageState; detail: string | null }>;
  claimPreview: Array<{ id: string; normalizedClaim: string; category: string }>;
  /** raw per-claim detail strings, per stage */
  details: Partial<Record<PipelineStage, Record<string, string>>>;
  partialResults: ClaimResult[];
  report: VerificationReport | null;
  error: { code: string; message: string } | null;
  startedAt: number | null;
}

const freshStages = (): RunState["stages"] =>
  Object.fromEntries(STAGES.map((s) => [s, { state: "pending" as StageState, detail: null }])) as RunState["stages"];

const initial: RunState = { status: "idle", stages: freshStages(), details: {}, claimPreview: [], partialResults: [], report: null, error: null, startedAt: null };

/** One claim: show its detail verbatim. Several: count progress instead of showing one claim's detail as if it were global. */
function summarize(details: Record<string, string>, states: StageState[], claimCount: number): string | null {
  const values = Object.values(details);
  if (claimCount <= 1 || values.length <= 1 && states.length <= 1) return values.at(-1) ?? null;
  const done = states.filter((s) => s === "done").length;
  const skipped = states.filter((s) => s === "skipped").length;
  const parts = [`${done} of ${claimCount} claims done`];
  if (skipped) parts.push(`${skipped} skipped`);
  return parts.join(", ");
}

/**
 * Streams /api/verify. Progress shown in the UI comes only from events the
 * server emits as each step actually runs (per claim), aggregated here.
 */
export function useVerification(onComplete?: (r: VerificationReport) => void) {
  const [state, setState] = useState<RunState>(initial);
  const abortRef = useRef<AbortController | null>(null);
  // per-claim, per-stage status so multi-claim runs aggregate honestly
  const perClaim = useRef<Map<string, Partial<Record<PipelineStage, StageState>>>>(new Map());

  const apply = useCallback(
    (e: VerificationEvent) => {
      setState((prev) => {
        const next: RunState = { ...prev, stages: { ...prev.stages } };
        switch (e.type) {
          case "stage": {
            const key = e.claimId ?? "_";
            const m = perClaim.current.get(key) ?? {};
            m[e.stage] = e.status === "start" ? "active" : e.status === "done" ? "done" : "skipped";
            perClaim.current.set(key, m);
            const states = [...perClaim.current.values()].map((x) => x[e.stage]).filter(Boolean) as StageState[];
            const agg: StageState = states.includes("active") ? "active" : states.includes("done") ? "done" : "skipped";
            const details = { ...prev.details[e.stage], ...(e.detail ? { [key]: e.detail } : {}) };
            next.details = { ...prev.details, [e.stage]: details };
            next.stages[e.stage] = { state: agg, detail: summarize(details, states, prev.claimPreview.length) };
            break;
          }
          case "claims":
            next.claimPreview = e.claims;
            break;
          case "claim_result":
            next.partialResults = [...prev.partialResults.filter((r) => r.claimId !== e.result.claimId), e.result];
            break;
          case "result": {
            for (const s of STAGES) {
              const cur = next.stages[s].state;
              if (cur === "active") next.stages[s] = { ...next.stages[s], state: "done" };
              if (cur === "pending") next.stages[s] = { ...next.stages[s], state: "skipped" };
            }
            next.report = e.report;
            next.status = "done";
            break;
          }
          case "error":
            next.status = "error";
            next.error = { code: e.code, message: e.message };
            break;
        }
        return next;
      });
      if (e.type === "result") onComplete?.(e.report);
    },
    [onComplete],
  );

  const run = useCallback(
    async (input: string) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      perClaim.current = new Map();
      setState({ ...initial, stages: freshStages(), status: "running", startedAt: Date.now() });
      try {
        const res = await fetch("/api/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => ({}));
          apply({ type: "error", code: body.code ?? `HTTP_${res.status}`, message: body.message ?? `Request failed (${res.status}).` });
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let gotResult = false;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            const evt = JSON.parse(line) as VerificationEvent;
            if (evt.type === "result" || evt.type === "error") gotResult = true;
            apply(evt);
          }
        }
        if (!gotResult) apply({ type: "error", code: "STREAM_ENDED", message: "The connection closed before a verdict arrived. Try again." });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        apply({ type: "error", code: "NETWORK", message: "Couldn't reach the Veritas server. Check that `npm run dev` is running." });
        console.error(err);
      }
    },
    [apply],
  );

  const show = useCallback((report: VerificationReport) => {
    abortRef.current?.abort();
    const stages = freshStages();
    for (const s of STAGES) stages[s] = { state: "done", detail: null };
    setState({ ...initial, stages, status: "done", report });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(initial);
  }, []);

  return { state, run, show, reset };
}
