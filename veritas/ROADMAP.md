# Veritas roadmap: from text box to live listening

The MVP engine already takes arbitrary text and emits real-time progress events, so live listening is mostly a new *front end* for the same engine.

```
microphone audio
  → speech-to-text (streaming, with speaker labels)
  → transcript segments (final only)
  → claim detection (is there a checkable assertion in this segment?)
  → claim de-duplication  (src/lib/live/claimDeduplicator.ts — done)
  → verifyClaim()          (src/lib/veritas/engine.ts — done)
  → live verdict feed      (timeline of claims with verdict chips)
```

## Phase 2 — minimal microphone prototype (≈1–2 days)

Goal: prove the loop works end-to-end in Chrome, cheaply.

1. **Transcript source:** browser Web Speech API (`webkitSpeechRecognition`, `continuous = true`, `interimResults = true`) wrapped in the `TranscriptSource` interface (`src/lib/live/types.ts`). Free, no server audio handling. Chrome/Edge only; accuracy is modest.
2. **Segmenting:** act only on `isFinal` results; merge fragments under ~6 words with the next segment.
3. **Claim detection:** a new `POST /api/live/detect` that calls the existing `parseClaims` with the segment plus the previous two segments as context (resolves "he"/"it"). Drop anything not `FACTUAL`.
4. **De-dup:** run normalized claims through `ClaimDeduplicator` (5-minute window).
5. **Verify:** reuse `/api/verify` per claim (results cache already makes repeats free).
6. **UI:** a two-column "Listen" view: rolling transcript on the left with checked spans underlined in verdict colours; verdict cards stacking on the right. Mic permission is already allowed for same-origin in `next.config.ts`.

## Phase 3 — production-grade listening

- **Streaming STT with diarization:** Deepgram or AssemblyAI over WebSocket (server-issued short-lived tokens; audio never stored by default).
- **Latency budget:** target < 4 s from end of sentence to verdict for cached/simple claims. Levers: Haiku-class claim detection on the fast path; pre-warmed search; reuse verdicts for paraphrased claims via embedding similarity; skip Wikipedia when Tavily already returned primary sources.
- **Claim worthiness scoring** so trivia and small talk don't flood the feed.
- **Speaker attribution** ("Speaker 2 claimed…") and an exportable transcript with inline citations.

## Evidence quality track (in parallel)

- Wikidata lookups for structured facts (capitals, dates of birth, office-holders).
- Optional fetch of full pages from an allow-list of primary domains, with SSRF protection and content-length caps.
- Larger labelled evaluation set (a few hundred claims across domains), tracked over time with precision on decided verdicts and abstention rate as the two headline numbers; then, and only then, calibrated confidence.
- Source-tier list moved to config and reviewed; per-domain freshness rules for time-sensitive topics.

## Platform

- Shared Redis/KV for caches and rate limits; per-user auth and quotas.
- Observability: per-stage latency histograms, provider error rates, cost per verified claim.
- Privacy: opt-in transcript retention, regional processing, deletion API.
