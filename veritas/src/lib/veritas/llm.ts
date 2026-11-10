import { SchemaError, type Validator, parseWith } from "./schema";
import { HttpError, errorMessage, fetchWithTimeout, withRetry } from "./util";
import { VeritasError } from "./types";

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface StructuredCall<T> {
  /** "fast" for extraction (Haiku-class), "smart" for evidence judgement (Sonnet-class). */
  tier: "fast" | "smart";
  system: string;
  user: string;
  tool: ToolSpec;
  validate: Validator<T>;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface LlmClient {
  readonly name: string;
  callStructured<T>(call: StructuredCall<T>): Promise<{ data: T; ms: number; model: string }>;
}

export interface AnthropicOptions {
  apiKey: string;
  baseUrl?: string;
  fastModel?: string;
  smartModel?: string;
  timeoutMs: number;
  retries: number;
  fetchImpl?: typeof fetch;
}

/**
 * Claude via the Messages API using a forced tool call for structured output.
 * Uses plain fetch (no SDK) so the engine stays dependency-free.
 * The tool's input is validated with our schema; on validation failure we
 * re-ask once with the validation error so the model can correct itself.
 */
export class AnthropicClient implements LlmClient {
  readonly name = "anthropic";
  private baseUrl: string;
  private fastModel: string;
  private smartModel: string;

  constructor(private opts: AnthropicOptions) {
    this.baseUrl = (opts.baseUrl || "https://api.anthropic.com").replace(/\/$/, "");
    this.fastModel = opts.fastModel || "claude-haiku-5-5";
    this.smartModel = opts.smartModel || "claude-sonnet-5-5";
  }

  async callStructured<T>(call: StructuredCall<T>): Promise<{ data: T; ms: number; model: string }> {
    const model = call.tier === "fast" ? this.fastModel : this.smartModel;
    const started = Date.now();
    const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [{ role: "user", content: call.user }];

    for (let attempt = 0; attempt < 2; attempt++) {
      const json = await withRetry(() => this.post(model, call, messages), this.opts.retries);
      const block = Array.isArray(json?.content)
        ? json.content.find((b: { type?: string; name?: string }) => b?.type === "tool_use" && b?.name === call.tool.name)
        : undefined;
      if (!block) {
        if (attempt === 0) {
          messages.push({ role: "assistant", content: json?.content ?? [] });
          messages.push({ role: "user", content: `Respond only by calling the ${call.tool.name} tool.` });
          continue;
        }
        throw new VeritasError("LLM_FAILED", "Model did not return structured output");
      }
      try {
        return { data: parseWith(call.validate, block.input), ms: Date.now() - started, model };
      } catch (err) {
        if (!(err instanceof SchemaError) || attempt === 1) {
          throw new VeritasError("LLM_FAILED", `Invalid structured output: ${errorMessage(err)}`);
        }
        messages.push({ role: "assistant", content: json.content });
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: block.id,
              is_error: true,
              content: `Schema validation failed: ${err.message}. Call ${call.tool.name} again with corrected input.`,
            },
          ],
        });
      }
    }
    throw new VeritasError("LLM_FAILED", "Structured output failed");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async post(model: string, call: StructuredCall<unknown>, messages: unknown[]): Promise<any> {
    const res = await fetchWithTimeout(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      timeoutMs: this.opts.timeoutMs,
      signal: call.signal,
      fetchImpl: this.opts.fetchImpl,
      headers: {
        "content-type": "application/json",
        "x-api-key": this.opts.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: call.maxTokens,
        system: call.system,
        messages,
        tools: [call.tool],
        tool_choice: { type: "tool", name: call.tool.name },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new HttpError(res.status, `Anthropic API ${res.status}: ${body.slice(0, 300)}`);
    }
    return res.json();
  }
}

export interface OpenRouterOptions {
  apiKey: string;
  baseUrl?: string;
  fastModel?: string;
  smartModel?: string;
  /** Optional attribution headers (HTTP-Referer / X-Title) shown on openrouter.ai. */
  siteUrl?: string;
  appName?: string;
  timeoutMs: number;
  retries: number;
  fetchImpl?: typeof fetch;
}

/**
 * Any model via OpenRouter's OpenAI-compatible Chat Completions API, using a
 * forced function call for structured output. Same contract as AnthropicClient:
 * validate the arguments, re-ask once with the validation error on failure.
 */
export class OpenRouterClient implements LlmClient {
  readonly name = "openrouter";
  private baseUrl: string;
  private fastModel: string;
  private smartModel: string;
  // Models that reject a forced tool_choice (e.g. claude-sonnet-5.5); these get "auto"
  // and rely on the re-ask in callStructured.
  private noForcedTool = new Set<string>();

  constructor(private opts: OpenRouterOptions) {
    this.baseUrl = (opts.baseUrl || "https://openrouter.ai/api/v1").replace(/\/$/, "");
    this.fastModel = opts.fastModel || "anthropic/claude-haiku-5.5";
    this.smartModel = opts.smartModel || "anthropic/claude-sonnet-5.5";
  }

  async callStructured<T>(call: StructuredCall<T>): Promise<{ data: T; ms: number; model: string }> {
    const model = call.tier === "fast" ? this.fastModel : this.smartModel;
    const started = Date.now();
    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: call.system },
      { role: "user", content: call.user },
    ];

    for (let attempt = 0; attempt < 2; attempt++) {
      const json = await withRetry(() => this.post(model, call, messages), this.opts.retries);
      const message = json?.choices?.[0]?.message;
      const toolCall = Array.isArray(message?.tool_calls)
        ? message.tool_calls.find((c: { function?: { name?: string } }) => c?.function?.name === call.tool.name)
        : undefined;
      if (!toolCall) {
        if (attempt === 0) {
          messages.push({ role: "assistant", content: message?.content ?? "" });
          messages.push({ role: "user", content: `Respond only by calling the ${call.tool.name} tool.` });
          continue;
        }
        throw new VeritasError("LLM_FAILED", "Model did not return structured output");
      }
      try {
        let args: unknown;
        try {
          args = JSON.parse(toolCall.function.arguments || "{}");
        } catch {
          throw new SchemaError("", "tool arguments are not valid JSON");
        }
        return { data: parseWith(call.validate, args), ms: Date.now() - started, model };
      } catch (err) {
        if (!(err instanceof SchemaError) || attempt === 1) {
          throw new VeritasError("LLM_FAILED", `Invalid structured output: ${errorMessage(err)}`);
        }
        messages.push({ role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: `Schema validation failed: ${err.message}. Call ${call.tool.name} again with corrected input.`,
        });
      }
    }
    throw new VeritasError("LLM_FAILED", "Structured output failed");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async post(model: string, call: StructuredCall<unknown>, messages: unknown[]): Promise<any> {
    const forced = !this.noForcedTool.has(model);
    try {
      return await this.request(model, call, messages, forced);
    } catch (err) {
      if (forced && err instanceof HttpError && err.status === 400 && err.message.includes("tool_choice")) {
        this.noForcedTool.add(model);
        return this.request(model, call, messages, false);
      }
      throw err;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async request(model: string, call: StructuredCall<unknown>, messages: unknown[], forced: boolean): Promise<any> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${this.opts.apiKey}`,
    };
    if (this.opts.siteUrl) headers["HTTP-Referer"] = this.opts.siteUrl;
    if (this.opts.appName) headers["X-Title"] = this.opts.appName;
    const res = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      timeoutMs: this.opts.timeoutMs,
      signal: call.signal,
      fetchImpl: this.opts.fetchImpl,
      headers,
      body: JSON.stringify({
        model,
        max_tokens: call.maxTokens,
        messages,
        tools: [{ type: "function", function: { name: call.tool.name, description: call.tool.description, parameters: call.tool.input_schema } }],
        tool_choice: forced ? { type: "function", function: { name: call.tool.name } } : "auto",
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new HttpError(res.status, `OpenRouter API ${res.status}: ${body.slice(0, 300)}`);
    }
    return res.json();
  }
}
