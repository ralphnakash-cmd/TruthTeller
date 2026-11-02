"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { VerificationReport } from "@/lib/veritas/types";
import { cn } from "@/lib/utils";
import { VERDICT_STYLE } from "./labels";

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function HistoryPanel({
  items,
  activeId,
  onOpen,
  onRemove,
  onClear,
}: {
  items: VerificationReport[];
  activeId: string | null;
  onOpen: (r: VerificationReport) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <aside aria-label="Recent verifications" className="self-start rounded-2xl border border-rule-soft bg-ink-2/50 p-4 lg:sticky lg:top-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-fg">Recent</h2>
        {items.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onClear} className="-mr-2 h-7 text-xs">
            Clear all
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-sm leading-relaxed text-faint">Claims you verify show up here. They&apos;re kept only in this browser.</p>
      ) : (
        <ul className="-mx-1 space-y-0.5">
          {items.map((r) => (
            <li key={r.id} className="group relative">
              <button
                type="button"
                onClick={() => onOpen(r)}
                className={cn(
                  "w-full rounded-lg px-2 py-2 pr-8 text-left transition-colors hover:bg-white/[0.04]",
                  activeId === r.id && "bg-white/[0.05]",
                )}
              >
                <span className="flex items-center gap-1.5">
                  {r.claims.map((c) => (
                    <span key={c.claimId} className={cn("size-2 rounded-full", VERDICT_STYLE[c.verdict].rule)} title={c.verdict} />
                  ))}
                  <span className="ml-1 text-[11px] text-faint">{ago(r.verifiedAt)}</span>
                  {r.mode === "DEMO" && <span className="text-[11px] text-unverified">demo</span>}
                </span>
                <span className="mt-1 line-clamp-2 block text-[13px] leading-snug text-fg/85">{r.input}</span>
              </button>
              <button
                type="button"
                onClick={() => onRemove(r.id)}
                aria-label="Remove from history"
                className="absolute top-2 right-1 rounded p-1 text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
