import { TTLCache } from "../src/lib/veritas/cache";
import { loadEngineConfig } from "../src/lib/veritas/config";
import type { EngineDeps } from "../src/lib/veritas/engine";
import type { LlmClient, StructuredCall } from "../src/lib/veritas/llm";
import type { SearchOptions, SearchProvider } from "../src/lib/veritas/providers/webSearchProvider";
import { parseWith } from "../src/lib/veritas/schema";
import type { ClaimResult, ProviderName, RawSearchResult, VerificationEvent } from "../src/lib/veritas/types";

type Handler = (call: StructuredCall<unknown>) => unknown;

/** Scripted LLM: routes by tool name; validates output with the real validators. */
export class MockLlm implements LlmClient {
  readonly name = "mock";
  calls: Array<{ tool: string; user: string; system: string }> = [];
  constructor(private handlers: Record<string, Handler>) {}
  async callStructured<T>(call: StructuredCall<T>) {
    this.calls.push({ tool: call.tool.name, user: call.user, system: call.system });
    const h = this.handlers[call.tool.name];
    if (!h) throw new Error(`no mock for ${call.tool.name}`);
    const raw = h(call as StructuredCall<unknown>);
    return { data: parseWith(call.validate, raw), ms: 5, model: "mock" };
  }
}

export class MockProvider implements SearchProvider {
  calls: string[] = [];
  constructor(
    readonly name: ProviderName,
    private impl: (q: string) => RawSearchResult[] | Promise<RawSearchResult[]>,
    readonly role: "web" | "reference" | "factcheck" = "web",
  ) {}
  async search(query: string, _opts: SearchOptions) {
    this.calls.push(query);
    return this.impl(query);
  }
}

export function hit(url: string, content: string, title = "Result", provider: ProviderName = "tavily"): RawSearchResult {
  return { url, content, title, publishedAt: null, score: 0.9, provider, query: "q" };
}

export interface ClaimSpec {
  original_text?: string;
  normalized_claim: string;
  category?: string;
  time_sensitivity?: string;
  clock_assertion?: { unit: string; value: string } | null;
  search_queries?: string[];
  key_entities?: string[];
  ambiguity_note?: string | null;
}

export function claimsOutput(...specs: ClaimSpec[]) {
  return {
    claims: specs.map((s) => ({
      original_text: s.original_text ?? s.normalized_claim,
      normalized_claim: s.normalized_claim,
      category: s.category ?? "FACTUAL",
      category_reason: "test",
      ambiguity_note: s.ambiguity_note ?? null,
      time_sensitivity: s.time_sensitivity ?? "NONE",
      clock_assertion: s.clock_assertion ?? null,
      search_queries: s.search_queries ?? [s.normalized_claim],
      key_entities: s.key_entities ?? [],
    })),
  };
}

export function assessment(
  verdict: "TRUE" | "FALSE" | "UNVERIFIED",
  items: Array<{ id: string; stance: string; quote?: string | null }>,
  explanation = "Test explanation [S1].",
) {
  return {
    verdict,
    explanation,
    assessments: items.map((i) => ({ source_id: i.id, stance: i.stance, quote: i.quote ?? null, rationale: "r" })),
  };
}

export const FIXED_NOW = new Date("2026-10-12T16:28:00Z"); // Monday 12:28 in New York

export function makeDeps(llm: LlmClient, providers: SearchProvider[], extra: Partial<EngineDeps> = {}): EngineDeps {
  return {
    llm,
    providers,
    config: loadEngineConfig({ searchTimeoutMs: 1000, llmTimeoutMs: 1000 }),
    resultCache: new TTLCache<ClaimResult>(),
    searchCache: new TTLCache<RawSearchResult[]>(),
    clock: () => FIXED_NOW,
    ...extra,
  };
}

export function collect(): { events: VerificationEvent[]; onEvent: (e: VerificationEvent) => void } {
  const events: VerificationEvent[] = [];
  return { events, onEvent: (e) => events.push(e) };
}

/** Parse the evidence blocks the engine sent to the model: id -> text. */
export function evidenceBlocks(user: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of user.matchAll(/<evidence id="(S\d+)"[^>]*>\n([\s\S]*?)\n<\/evidence>/g)) out.set(m[1], m[2]);
  return out;
}

/**
 * Build an assessment the way a well-behaved model would: for each evidence
 * block containing `match`, assign `stance` and quote the matched text verbatim.
 */
export function judge(
  user: string,
  verdict: "TRUE" | "FALSE" | "UNVERIFIED",
  rules: Array<{ match: string; stance: string; quote?: string }>,
  explanation = "Test explanation [S1].",
) {
  const items: Array<{ id: string; stance: string; quote: string | null }> = [];
  for (const [id, text] of evidenceBlocks(user)) {
    const rule = rules.find((r) => text.includes(r.match));
    items.push(rule ? { id, stance: rule.stance, quote: rule.quote ?? rule.match } : { id, stance: "IRRELEVANT", quote: null });
  }
  return assessment(verdict, items, explanation);
}
