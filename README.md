# TruthTeller
Live Listen AI that detects misinformation
# Veritas

**Real-time intelligence. Evidence-based truth.**

Veritas is an MVP of an evidence-grounded fact checker. Type a statement; Veritas splits it into individual claims, searches the live web and Wikipedia, has Claude judge each claim *against the retrieved text only*, and then runs a deterministic evidence gate that decides whether the result may be shown as **TRUE**, **FALSE**, or must be **UNVERIFIED**.

The engine is framework-independent so the same code can later sit behind a live speech-to-text stream (see [ROADMAP.md](./ROADMAP.md)).

---

## Quick start

Requires Node.js 20.12+.

```bash
npm install
cp .env.example .env.local      # then add your keys
npm run dev                     # http://localhost:3000
```

| Variable | Needed? | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Required** for live mode | Claude extracts claims (Haiku 5.5) and evaluates evidence (Sonnet 5.5). |
| `TAVILY_API_KEY` | Strongly recommended | Live web search. Without it, evidence comes from Wikipedia only and many claims end UNVERIFIED. |
| `BRAVE_SEARCH_API_KEY` | Optional | Alternative web search, used only when no Tavily key is set. |
| `GOOGLE_FACTCHECK_API_KEY` | Optional | Adds published fact-checks (ClaimReview data). |
| `VERITAS_DEMO_MODE=true` | Optional | Click through the UI with **no keys**. Every result is stamped DEMO, has no links, and says no search ran. It is never used as a silent fallback. |

The header shows which sources are configured (green dot = active). If the Anthropic key is missing, the app tells you instead of pretending to verify.

```bash
npm test            # 49 deterministic unit tests (mocked APIs, no keys needed)
npm run eval:live   # live evaluation against real APIs (uses credits)
npm run typecheck
```

---

## How a claim is verified

```
input text
  │
  ├─ claimParser ............ Claude (fast model): split into propositions, normalize wording
  │                           (fix spelling, drop hedges, keep meaning), classify, propose queries
  ├─ factCheckabilityClassifier  deterministic guard-rails: questions/predictions/opinions/
  │                           ambiguous → UNVERIFIED with a reason code; never upgrades a claim
  │
  ├─ (date claims) temporal ... "Today is …" is checked against the server clock in the
  │                           user's timezone at request time — no web search, no model guess
  │
  ├─ searchQueryGenerator ... ≤3 sanitized queries, falls back to the normalized claim
  ├─ webSearchProvider ...... Tavily or Brave (every query), Wikipedia (reference lookup),
  │   evidenceRetriever       Google Fact Check (optional) — all concurrent, with timeouts,
  │                           retries and caching; URLs canonicalized and de-duplicated
  ├─ sourceEvaluator ........ transparent tiers + independence groups (same site or
  │                           copied text = one source)
  ├─ verdictEngine .......... Claude (smart model) assesses every source: stance + a quote
  │                           copied verbatim from that source, then proposes a verdict
  ├─ evidence gate .......... deterministic: checks every quote really exists in the
  │                           retrieved text, weighs independent sources by tier, and
  │                           downgrades to UNVERIFIED when the evidence isn't there
  └─ resultFormatter ........ citations built only from retrieved records
```

The UI's progress track is driven by events the server emits as each step actually runs. If a step is skipped (e.g. a date claim needs no search, or a cached result is reused), it is shown as skipped with the reason.

### The evidence gate (why the model can't just "believe" something)

The model **proposes**; the gate **decides**, and can only downgrade.

1. A source counts as supporting/contradicting only if the model's quote is found verbatim in the text we retrieved. Fabricated or paraphrased quotes are discarded and labelled.
2. Each counted source is weighted by tier: primary or fact-checker **3**, reference or major news **2**, general web **1**, user-generated **0.5**.
3. Sources are grouped for independence (same registrable domain, or ≥50% shingle overlap = syndicated copy). Each group counts once, at its best weight.
4. **TRUE/FALSE require weight ≥ 2 on that side** and no comparable opposing evidence (opposing ≥ 2 and more than half the winning weight ⇒ `CONFLICTING_EVIDENCE`).
5. Evidence strength (Strong / Moderate / Limited) is derived from that weight and the number of independent sources. Veritas deliberately shows **no confidence percentage**: there is no calibration data to back one.

UNVERIFIED always carries a reason code: `OPINION`, `PREDICTION`, `QUESTION`, `AMBIGUOUS`, `NOT_A_CLAIM`, `INSUFFICIENT_EVIDENCE`, `CONFLICTING_EVIDENCE`, `NO_RESULTS`, `SEARCH_FAILED`, `LLM_FAILED`.

---

## Where the truth comes from — source strategy

| Source | Role | Why | Limitations |
|---|---|---|---|
| **Tavily Search API** (primary web search) | Every search query | Built for LLM agents: returns clean text snippets + URLs + optional dates in one call, so no page scraping is needed. Free tier available; simple REST. We set `include_answer: false` so Tavily's own AI summary is never used as evidence. | Snippets can miss the decisive sentence; ranking is not a trust signal (we don't use it as one); index freshness varies. |
| **Brave Search API** (alternative) | Swap-in web search | Independent index, generous free tier, `extra_snippets` give more text. | Snippets shorter than Tavily's; same ranking caveat. |
| **Wikipedia (MediaWiki Action API)** | Reference lookup on the first query | Free, no key, stable, great for encyclopedic history/geography/science. | Lead sections only; Wikipedia is a tertiary source and can be wrong or vandalized, so it's tiered *Reference* (weight 2), never *Primary*. |
| **Google Fact Check Tools API** (optional) | Prior fact-checks | Surfaces ClaimReview ratings from established fact-checkers for viral/political claims. | Sparse for everyday facts; ratings are free text; coverage skews English/US. |
| **Server clock** | "Today's date/day/month/year" claims | The only authoritative source for the current date. | Assumes the host clock is NTP-synced; uses the browser's reported timezone. |
| **Claude** (Haiku 5.5 for extraction, Sonnet 5.5 for evaluation) | Interpreting claims and reading evidence | Strong reading comprehension, reliable forced tool-use for structured output. | Can misread evidence or miss nuance; mitigated by verbatim-quote verification and the gate, not eliminated. |

**Considered and deferred:** Wikidata SPARQL (precise for structured facts like "capital of X" but needs per-claim query generation that's brittle for an MVP); direct page fetching (more context but adds SSRF surface, latency and HTML-parsing failure modes).

**Source tiers** are a short, readable allow-list (`sourceEvaluator.ts`): `.gov`/`.mil`/government, universities, NASA/NIH/WHO/etc. are *Primary*; Britannica/Wikipedia/major references are *Reference*; Reuters/AP/BBC etc. are *News*; Snopes/PolitiFact/FactCheck.org are *Fact-checker*; Reddit/Quora/social are *User-generated*. A site whose name matches an organization in the claim (e.g. `apple.com` for a MacBook claim) is treated as an official primary source for that claim. Every tier is shown in the UI with its reason.

### Known limitations (honest list)

- **Snippet-level evidence.** Verdicts rest on search snippets and Wikipedia intros. A true claim whose proof sits deeper in a page will often come back UNVERIFIED. That's the intended failure direction.
- **Tiering is heuristic.** A domain list is not a credibility model; a government page can be outdated, a blog can be right.
- **Entity matching for "official site"** relies on the model listing the brand owner (MacBook → Apple). If it doesn't, `apple.com` is weighted as general web.
- **English-centric** prompts, Wikipedia and fact-check queries.
- **Single-instance state.** Caches and the rate limiter live in memory; use Redis/KV for multiple instances.
- **Small evaluation set.** The bundled live eval is a smoke test, not an accuracy claim.

---

## Testing

**Unit tests (`npm test`)** — 49 deterministic tests with mocked LLM and search responses. They test the engine's logic, not real-world accuracy:

1. True historical facts · 2. False product claims · 3. Scientific facts · 4. Date-dependent statements (incl. timezone edge cases and "no search was claimed") · 5. Spelling mistakes · 6. Ambiguous statements · 7. Opinions, predictions, questions · 8. Conflicting evidence · 9. No search results · 10. Search API failures (total and partial) · 11. LLM failures (analysis and malformed evaluation output) · 12. Multiple propositions — plus evidence-integrity tests (fabricated quotes, low-quality-only sources, syndicated copies, references to non-existent sources, prompt injection inside sources), provider response parsing for Tavily/Brave/Wikipedia, the Anthropic client's retry and schema-repair loop, caching, and input validation.

**Live evaluation (`npm run eval:live`)** — runs ~22 independently prepared cases (`tests/live/expected.ts`) through the real APIs and reports **correct**, **incorrect** (the dangerous kind) and **abstentions** separately, plus decided accuracy and coverage. Date cases are generated from the real clock at run time.

---

## Privacy & security

- All API keys are read server-side only (`src/lib/veritas/factory.ts`); the browser never sees them. `/api/health` exposes booleans and model names only.
- Input is length-limited (600 chars, body 8 KB) and rate-limited per client (12/min by default).
- **No arbitrary URL fetching:** the server only calls fixed API hosts (Anthropic, Tavily/Brave, Wikipedia, Google). Result URLs are canonicalized, restricted to http(s), and only rendered as `rel="noopener noreferrer nofollow"` links.
- Retrieved web text is treated as untrusted data: HTML/control characters are stripped, evidence-delimiter tags are neutralized, and the model is instructed to ignore instructions inside sources. Even if it didn't, the gate requires verifiable quotes from multiple independent sources.
- Server logs record a hash, claim count and verdicts — never the text you typed.
- Verification history lives only in your browser's localStorage and can be deleted per item or cleared.

## Performance & cost controls

Per-claim queries ≤ 3, results per query ≤ 5, sources sent to the model ≤ 8 (excerpts ≤ 1,200 chars); claims per input ≤ 4, verified concurrently (3 at a time); searches run in parallel. Timeouts: 8 s per search call, 30 s per LLM call; retries with backoff on 429/5xx/529 and network errors only. Caches: verified claims 6 h (10 min for time-sensitive claims; date-of-today claims are never cached); search responses 1 h. Timings for search, evaluation and total are shown in the UI under *How this was checked*. All limits are overridable in `.env.local`.

## Project layout

```
src/
  app/
    api/verify/route.ts     streaming NDJSON endpoint (real progress events)
    api/health/route.ts     which sources are configured
    page.tsx, layout.tsx, globals.css
  components/
    ui/                     shadcn/ui-style primitives (button, badge)
    veritas/                VeritasApp, ClaimComposer, PipelineTrack, ResultCard,
                            EvidenceBalance, SourceCard, HistoryPanel
  lib/
    veritas/                the engine (zero runtime dependencies)
      engine.ts             orchestration: verifyText() / verifyClaim()
      claimParser.ts  factCheckabilityClassifier.ts  searchQueryGenerator.ts
      providers/            Tavily, Brave, Wikipedia, Google Fact Check
      evidenceRetriever.ts  sourceEvaluator.ts  verdictEngine.ts (incl. the gate)
      resultFormatter.ts  temporal.ts  cache.ts  llm.ts  schema.ts  types.ts  factory.ts  demo.ts
    live/                   Phase-2 building blocks (claim de-duplication, transcript contracts)
    client/                 streaming hook + local history
tests/
  unit/                     mocked, deterministic
  live/                     real-API evaluation + expected answers
```

Structured output uses Claude's forced tool calls, validated by a small built-in schema validator (`schema.ts`); invalid output triggers one self-correction round, then fails safely to UNVERIFIED/LLM_FAILED.
