import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ClaimDeduplicator } from "../../src/lib/live/claimDeduplicator";
import { TTLCache } from "../../src/lib/veritas/cache";
import { assessCheckability } from "../../src/lib/veritas/factCheckabilityClassifier";
import { AnthropicClient } from "../../src/lib/veritas/llm";
import { BraveProvider, TavilyProvider } from "../../src/lib/veritas/providers/webSearchProvider";
import { WikipediaProvider } from "../../src/lib/veritas/providers/wikipedia";
import { retrieveEvidence } from "../../src/lib/veritas/evidenceRetriever";
import { reportToText } from "../../src/lib/veritas/resultFormatter";
import { s } from "../../src/lib/veritas/schema";
import { generateSearchQueries } from "../../src/lib/veritas/searchQueryGenerator";
import { assessSource } from "../../src/lib/veritas/sourceEvaluator";
import { checkClockClaim } from "../../src/lib/veritas/temporal";
import type { ParsedClaim } from "../../src/lib/veritas/types";
import { quoteAppearsIn } from "../../src/lib/veritas/verdictEngine";
import { canonicalUrl, registrableDomain, sanitizeText } from "../../src/lib/veritas/util";
import { MockProvider, hit } from "../helpers";

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const baseClaim: ParsedClaim = {
  id: "c1",
  originalText: "x",
  normalizedClaim: "Paris is the capital of France.",
  category: "FACTUAL",
  categoryReason: "",
  ambiguityNote: null,
  timeSensitivity: "NONE",
  clockAssertion: null,
  searchQueries: [],
  keyEntities: [],
};

describe("quote verification", () => {
  const excerpt = "George Washington was the first President of the United States, serving from 1789 to 1797.";
  it("accepts verbatim quotes regardless of case, whitespace and curly quotes", () => {
    assert.ok(quoteAppearsIn("the FIRST   President of the United States", excerpt));
    assert.ok(quoteAppearsIn("George Washington was the first ... serving from 1789 to 1797", excerpt));
  });
  it("rejects paraphrases, tiny fragments and out-of-order fragments", () => {
    assert.ok(!quoteAppearsIn("Washington was America's first president", excerpt));
    assert.ok(!quoteAppearsIn("the", excerpt));
    assert.ok(!quoteAppearsIn("serving from 1789 ... George Washington", excerpt));
    assert.ok(!quoteAppearsIn(null, excerpt));
  });
});

describe("source evaluation", () => {
  it("tiers sources transparently", () => {
    assert.equal(assessSource("archives.gov", []).tier, "PRIMARY");
    assert.equal(assessSource("science.nasa.gov", []).publisher, "NASA");
    assert.equal(assessSource("dmv.ca.gov", []).tier, "PRIMARY");
    assert.equal(assessSource("history.stanford.edu", []).tier, "PRIMARY");
    assert.equal(assessSource("en.wikipedia.org", []).tier, "REFERENCE");
    assert.equal(assessSource("www.reddit.com", []).tier, "LOW");
    assert.equal(assessSource("random-blog.net", []).tier, "GENERAL");
    assert.equal(assessSource("apple.com", ["MacBook", "Apple"]).tier, "PRIMARY");
    assert.equal(assessSource("apple.com", ["MacBook"]).tier, "GENERAL");
  });
  it("computes registrable domains", () => {
    assert.equal(registrableDomain("news.bbc.co.uk"), "bbc.co.uk");
    assert.equal(registrableDomain("science.nasa.gov"), "nasa.gov");
  });
});

describe("evidence retrieval hygiene", () => {
  it("drops unsafe URLs, strips tracking params and de-duplicates", async () => {
    const p = new MockProvider("tavily", () => [
      hit("javascript:alert(1)", "malicious content that is long enough to pass"),
      hit("https://www.example.com/page?utm_source=x#frag", "Some useful content about the subject at hand."),
      hit("https://example.com/page", "Some useful content about the subject at hand, longer version."),
      hit("https://ok.org/a", "<script>alert(1)</script> Clean <b>text</b> here about the subject."),
    ]);
    const r = await retrieveEvidence([p], { queries: ["q"], primaryQuery: "q", entities: [], resultsPerQuery: 5, maxSources: 8, maxExcerptChars: 500 });
    assert.equal(r.records.length, 2);
    assert.equal(r.records[0].url, "https://example.com/page");
    assert.match(r.records[0].excerpt, /longer version/);
    assert.ok(!r.records[1].excerpt.includes("<"));
  });
  it("sanitizes control characters and caps length", () => {
    assert.equal(sanitizeText("a\u0000b‮c   d", 100), "abc d");
    assert.ok(sanitizeText("word ".repeat(100), 20).length <= 21);
    assert.equal(canonicalUrl("ftp://x.com/a"), null);
  });
});

describe("providers parse real API shapes", () => {
  it("Tavily", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return jsonResponse({ results: [{ title: "T", url: "https://a.gov/x", content: "C", score: 0.8, published_date: "2025-01-01" }] });
    }) as unknown as typeof fetch;
    const out = await new TavilyProvider({ apiKey: "k", timeoutMs: 500, fetchImpl }).search("who makes macbook", { limit: 4 });
    assert.equal(body.include_answer, false);
    assert.equal(body.max_results, 4);
    assert.deepEqual(out[0], { title: "T", url: "https://a.gov/x", content: "C", publishedAt: "2025-01-01", score: 0.8, provider: "tavily", query: "who makes macbook" });
  });
  it("Brave", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ web: { results: [{ title: "<strong>B</strong>", url: "https://b.com", description: "desc", extra_snippets: ["more"] }] } })) as unknown as typeof fetch;
    const out = await new BraveProvider({ apiKey: "k", timeoutMs: 500, fetchImpl }).search("q", { limit: 3 });
    assert.equal(out[0].title, "B");
    assert.match(out[0].content, /desc … more/);
  });
  it("Wikipedia", async () => {
    let calledUrl = "";
    const fetchImpl = (async (url: string) => {
      calledUrl = url;
      return jsonResponse({ query: { pages: [{ title: "Paris", fullurl: "https://en.wikipedia.org/wiki/Paris", extract: "Paris is the capital and largest city of France. ".repeat(2), index: 1 }] } });
    }) as unknown as typeof fetch;
    const out = await new WikipediaProvider({ timeoutMs: 500, userAgent: "test", fetchImpl }).search("capital of France", { limit: 3 });
    assert.ok(calledUrl.startsWith("https://en.wikipedia.org/w/api.php"));
    assert.equal(out[0].url, "https://en.wikipedia.org/wiki/Paris");
  });
  it("surfaces HTTP errors", async () => {
    const fetchImpl = (async () => new Response("bad key", { status: 401 })) as unknown as typeof fetch;
    await assert.rejects(new TavilyProvider({ apiKey: "k", timeoutMs: 500, fetchImpl, retries: 0 }).search("q", { limit: 1 }), /401/);
  });
});

describe("Anthropic client", () => {
  const tool = { name: "t", description: "d", input_schema: { type: "object" } };
  const validate = s.object({ answer: s.enumOf(["A", "B"] as const) });

  it("forces the tool, retries on 529, and re-asks once on schema errors", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const responses = [
      new Response("overloaded", { status: 529 }),
      jsonResponse({ content: [{ type: "tool_use", id: "tu1", name: "t", input: { answer: "C" } }] }),
      jsonResponse({ content: [{ type: "tool_use", id: "tu2", name: "t", input: { answer: "b" } }] }),
    ];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return responses.shift()!;
    }) as unknown as typeof fetch;
    const client = new AnthropicClient({ apiKey: "k", timeoutMs: 1000, retries: 2, fetchImpl });
    const out = await client.callStructured({ tier: "fast", system: "s", user: "u", tool, validate, maxTokens: 100 });
    assert.equal(out.data.answer, "B");
    assert.deepEqual(bodies[0].tool_choice, { type: "tool", name: "t" });
    assert.equal(bodies[0].model, "claude-haiku-5-5");
    assert.equal(bodies.length, 3);
    const lastMsgs = bodies[2].messages as Array<{ role: string; content: unknown }>;
    assert.match(JSON.stringify(lastMsgs.at(-1)), /Schema validation failed/);
  });

  it("does not retry auth errors", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      return new Response("invalid x-api-key", { status: 401 });
    }) as unknown as typeof fetch;
    const client = new AnthropicClient({ apiKey: "bad", timeoutMs: 1000, retries: 2, fetchImpl });
    await assert.rejects(client.callStructured({ tier: "smart", system: "s", user: "u", tool, validate, maxTokens: 10 }), /401/);
    assert.equal(n, 1);
  });
});

describe("checkability guard-rails", () => {
  it("never upgrades a non-factual category", () => {
    assert.equal(assessCheckability({ ...baseClaim, category: "OPINION" }).checkable, false);
  });
  it("demotes future-tense predictions", () => {
    assert.equal(assessCheckability({ ...baseClaim, normalizedClaim: "The Lakers will win the title next year." }).reasonCode, "PREDICTION");
  });
  it("demotes clock claims with no interpretable value", () => {
    assert.equal(assessCheckability({ ...baseClaim, timeSensitivity: "CURRENT_CLOCK" }).reasonCode, "AMBIGUOUS");
  });
});

describe("misc", () => {
  it("query generator strips operators, de-dupes and falls back to the claim", () => {
    assert.deepEqual(generateSearchQueries({ ...baseClaim, searchQueries: ['"capital of France" site:gov', "capital of france", "x"] }, 3), ["capital of France"]);
    assert.deepEqual(generateSearchQueries(baseClaim, 3), ["Paris is the capital of France."]);
  });
  it("clock check rejects impossible dates", () => {
    assert.equal(checkClockClaim({ unit: "DATE", value: "2026-02-30" }, new Date(), "UTC").verdict, null);
  });
  it("TTL cache expires and evicts", () => {
    let t = 0;
    const c = new TTLCache<number>(2, () => t);
    c.set("a", 1, 10);
    c.set("b", 2, 10);
    c.set("c", 3, 10);
    assert.equal(c.get("a"), undefined);
    t = 11;
    assert.equal(c.get("b"), undefined);
  });
  it("live deduplicator suppresses rephrased repeats within the window", () => {
    let t = 0;
    const d = new ClaimDeduplicator(60_000, 0.6, () => t);
    assert.equal(d.admit("George Washington was the first president of the United States."), true);
    assert.equal(d.admit("George Washington was the first President of the United States"), false);
    assert.equal(d.admit("Paris is the capital of France."), true);
    t = 61_000;
    assert.equal(d.admit("George Washington was the first president of the United States."), true);
  });
  it("copy text includes verdict and links", () => {
    const text = reportToText({
      id: "r",
      mode: "LIVE",
      input: "x",
      timezone: "UTC",
      verifiedAt: "2026-10-12T00:00:00Z",
      durationMs: 1200,
      timings: { parseMs: 0, claimsMs: 0, totalMs: 0 },
      warnings: [],
      claims: [],
    });
    assert.match(text, /Total time: 1.2s/);
  });
});
