import { TTLCache } from "./cache";
import { loadEngineConfig } from "./config";
import type { EngineDeps } from "./engine";
import { AnthropicClient, OpenRouterClient } from "./llm";
import { GoogleFactCheckProvider } from "./providers/googleFactCheck";
import { BraveProvider, type SearchProvider, TavilyProvider } from "./providers/webSearchProvider";
import { WikipediaProvider } from "./providers/wikipedia";
import type { ClaimResult, RawSearchResult } from "./types";

export interface ServiceStatus {
  llm: { configured: boolean; provider: "openrouter" | "anthropic"; fastModel: string; smartModel: string };
  webSearch: "tavily" | "brave" | null;
  wikipedia: boolean;
  factCheck: boolean;
  demoMode: boolean;
}

const env = (k: string) => (process.env[k] ?? "").trim();

export function serviceStatus(): ServiceStatus {
  // OpenRouter wins when its key is set; ANTHROPIC_API_KEY remains a direct fallback.
  const openrouter = Boolean(env("OPENROUTER_API_KEY")) || !env("ANTHROPIC_API_KEY");
  return {
    llm: {
      configured: Boolean(env("OPENROUTER_API_KEY") || env("ANTHROPIC_API_KEY")),
      provider: openrouter ? "openrouter" : "anthropic",
      fastModel: env("VERITAS_FAST_MODEL") || (openrouter ? "anthropic/claude-haiku-5.5" : "claude-haiku-5-5"),
      smartModel: env("VERITAS_SMART_MODEL") || (openrouter ? "anthropic/claude-sonnet-5.5" : "claude-sonnet-5-5"),
    },
    webSearch: env("TAVILY_API_KEY") ? "tavily" : env("BRAVE_SEARCH_API_KEY") ? "brave" : null,
    wikipedia: env("VERITAS_DISABLE_WIKIPEDIA") !== "true",
    factCheck: Boolean(env("GOOGLE_FACTCHECK_API_KEY")),
    demoMode: env("VERITAS_DEMO_MODE") === "true",
  };
}

// Caches live on globalThis so they survive Next.js dev hot-reloads.
const g = globalThis as unknown as { __veritasCaches?: { results: TTLCache<ClaimResult>; search: TTLCache<RawSearchResult[]> } };
g.__veritasCaches ??= { results: new TTLCache<ClaimResult>(500), search: new TTLCache<RawSearchResult[]>(1000) };

/** Build engine dependencies from server-side environment variables. Keys never leave the server. */
export function createEngineDeps(): EngineDeps | null {
  const status = serviceStatus();
  if (!status.llm.configured) return null;
  const config = loadEngineConfig();
  const providers: SearchProvider[] = [];
  const warnings: string[] = [];

  if (status.webSearch === "tavily") providers.push(new TavilyProvider({ apiKey: env("TAVILY_API_KEY"), timeoutMs: config.searchTimeoutMs }));
  else if (status.webSearch === "brave") providers.push(new BraveProvider({ apiKey: env("BRAVE_SEARCH_API_KEY"), timeoutMs: config.searchTimeoutMs }));
  else warnings.push("No web search API key configured — evidence is limited to Wikipedia. Add TAVILY_API_KEY for full web search.");

  if (status.wikipedia) {
    providers.push(
      new WikipediaProvider({
        timeoutMs: config.searchTimeoutMs,
        userAgent: `VeritasFactCheckMVP/0.1 (${env("VERITAS_CONTACT") || "local development"})`,
      }),
    );
  }
  if (status.factCheck) providers.push(new GoogleFactCheckProvider({ apiKey: env("GOOGLE_FACTCHECK_API_KEY"), timeoutMs: config.searchTimeoutMs }));

  return {
    llm:
      status.llm.provider === "openrouter"
        ? new OpenRouterClient({
            apiKey: env("OPENROUTER_API_KEY"),
            baseUrl: env("VERITAS_OPENROUTER_BASE_URL") || undefined,
            fastModel: status.llm.fastModel,
            smartModel: status.llm.smartModel,
            siteUrl: env("VERITAS_SITE_URL") || undefined,
            appName: "Veritas",
            timeoutMs: config.llmTimeoutMs,
            retries: config.llmRetries,
          })
        : new AnthropicClient({
            apiKey: env("ANTHROPIC_API_KEY"),
            baseUrl: env("VERITAS_ANTHROPIC_BASE_URL") || undefined,
            fastModel: status.llm.fastModel,
            smartModel: status.llm.smartModel,
            timeoutMs: config.llmTimeoutMs,
            retries: config.llmRetries,
          }),
    providers,
    config,
    resultCache: g.__veritasCaches!.results,
    searchCache: g.__veritasCaches!.search,
    warnings,
  };
}
