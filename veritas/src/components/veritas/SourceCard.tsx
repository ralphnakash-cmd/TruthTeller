"use client";

import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SourceCitation } from "@/lib/veritas/types";
import { cn } from "@/lib/utils";
import { STANCE_LABEL, TIER_LABEL } from "./labels";

function safeHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function SourceCard({ source, anchorPrefix, compact = false }: { source: SourceCitation; anchorPrefix: string; compact?: boolean }) {
  const href = safeHref(source.url);
  const stance = STANCE_LABEL[source.stance];
  const published = formatDate(source.publishedAt);
  const accent = source.stance === "SUPPORTS" ? "border-l-true/70" : source.stance === "CONTRADICTS" ? "border-l-false/70" : "border-l-rule";

  return (
    <article id={`${anchorPrefix}-${source.id}`} className={cn("scroll-mt-24 rounded-xl border border-rule-soft border-l-2 bg-ink-2/70 p-4 target:border-ice/50", accent)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-faint">{source.id}</span>
        <span className="text-sm font-medium text-fg">{source.publisher}</span>
        <Badge tone={source.tier === "PRIMARY" || source.tier === "FACT_CHECK" ? "ice" : "neutral"} title={source.tierReason}>
          {TIER_LABEL[source.tier]}
        </Badge>
        <Badge tone={stance.tone} className="ml-auto">
          {stance.word}
        </Badge>
      </div>

      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="group mt-2 flex items-start gap-1.5 text-[15px] leading-snug text-ice hover:underline">
          <span className="min-w-0">{source.title}</span>
          <ExternalLink className="mt-1 size-3.5 shrink-0 opacity-60 group-hover:opacity-100" aria-label="opens in a new tab" />
        </a>
      ) : (
        <p className="mt-2 text-[15px] leading-snug text-fg">{source.title}</p>
      )}
      {source.domain && <p className="mt-0.5 truncate font-mono text-[11px] text-faint">{source.domain}</p>}

      {!compact && (
        <>
          <blockquote className="mt-3 border-l border-rule pl-3 font-serif text-[15px] leading-relaxed text-fg/90">
            {source.excerptIsVerifiedQuote ? `“${source.excerpt}”` : source.excerpt}
          </blockquote>
          <p className="mt-2 text-[11px] text-faint">
            {source.excerptIsVerifiedQuote ? "Quoted verbatim from the retrieved text" : "Excerpt from the retrieved text"}
            {published ? `, published ${published}` : ""}
          </p>
        </>
      )}
      {source.rationale && <p className="mt-2 text-xs leading-relaxed text-muted">{source.rationale}</p>}
    </article>
  );
}
