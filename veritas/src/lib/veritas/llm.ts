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
