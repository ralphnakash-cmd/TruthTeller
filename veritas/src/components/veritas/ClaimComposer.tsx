"use client";

import { Loader2, ScanSearch } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EXAMPLES } from "./labels";

const MAX = 600;

export function ClaimComposer({
  value,
  onChange,
  onSubmit,
  running,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  running: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const trimmed = value.trim();
  const tooLong = value.length > MAX;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [value]);

  const submit = () => {
    if (!running && trimmed.length >= 3 && !tooLong) onSubmit(trimmed);
  };

  return (
    <div>
      <form
        className="group relative rounded-2xl border border-rule bg-ink-2/80 backdrop-blur transition-colors focus-within:border-ice/45"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="claim" className="sr-only">
          Statement to verify
        </label>
        <textarea
          id="claim"
          ref={ref}
          rows={2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Enter a statement to verify..."
          className="block w-full resize-none bg-transparent px-5 pt-5 pb-2 font-serif text-[22px] leading-snug text-fg placeholder:text-faint focus:outline-none sm:text-2xl"
        />
        <div className="flex items-center justify-between gap-3 px-4 pb-4 pl-5">
          <p className={cn("text-xs tabular-nums", tooLong ? "text-false" : "text-faint")}>
            {tooLong ? `${value.length - MAX} characters over the limit` : `${value.length} / ${MAX}`}
            <span className="ml-3 hidden text-faint sm:inline">Enter to verify, Shift+Enter for a new line</span>
          </p>
          <Button type="submit" size="lg" disabled={running || trimmed.length < 3 || tooLong}>
            {running ? <Loader2 className="animate-spin" /> : <ScanSearch />}
            {running ? "Verifying" : "Verify Claim"}
          </Button>
        </div>
      </form>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm text-faint">Try one:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={running}
            onClick={() => {
              onChange(ex);
              onSubmit(ex);
            }}
            className="rounded-full border border-rule-soft bg-white/[0.02] px-3 py-1.5 text-left text-[13px] text-muted transition-colors hover:border-ice/40 hover:text-fg disabled:opacity-40"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
