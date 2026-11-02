import { rateLimit } from "@/lib/server/rateLimit";
import { demoReport } from "@/lib/veritas/demo";
import { verifyText } from "@/lib/veritas/engine";
import { createEngineDeps, serviceStatus } from "@/lib/veritas/factory";
import { type VerificationEvent, VeritasError } from "@/lib/veritas/types";
import { fnv1a } from "@/lib/veritas/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = Number(process.env.VERITAS_RATE_LIMIT_PER_MIN) || 12;

function clientKey(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

function json(body: unknown, status: number, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extra } });
}

/**
 * POST /api/verify  { input: string, timezone?: string }
 * Streams newline-delimited JSON VerificationEvents. Stage events are emitted
 * by the engine only as each step actually runs, so the UI's progress is real.
 */
export async function POST(req: Request) {
  const rl = rateLimit(clientKey(req), RATE_LIMIT, 60_000);
  if (!rl.ok) return json({ code: "RATE_LIMITED", message: `Too many requests. Try again in ${rl.retryAfterSec}s.` }, 429, { "retry-after": String(rl.retryAfterSec) });

  let body: { input?: unknown; timezone?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > 8_000) return json({ code: "INPUT_INVALID", message: "Request too large." }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ code: "INPUT_INVALID", message: "Body must be JSON." }, 400);
  }
  const timezone = typeof body.timezone === "string" && body.timezone.length < 64 ? body.timezone : "UTC";

  const status = serviceStatus();
  if (status.demoMode) {
    if (typeof body.input !== "string" || !body.input.trim()) return json({ code: "INPUT_INVALID", message: "Enter a statement to verify." }, 400);
    const report = demoReport(body.input.trim().slice(0, 600), timezone);
    const lines = [{ type: "result", report } satisfies VerificationEvent].map((e) => JSON.stringify(e)).join("\n") + "\n";
    return new Response(lines, { headers: { "content-type": "application/x-ndjson; charset=utf-8" } });
  }

  const deps = createEngineDeps();
  if (!deps) {
    return json(
      { code: "NOT_CONFIGURED", message: "Live verification needs ANTHROPIC_API_KEY (and ideally TAVILY_API_KEY) in .env.local. See README → Setup." },
      503,
    );
  }

  const encoder = new TextEncoder();
  const started = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: VerificationEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          /* client went away */
        }
      };
      try {
        const report = await verifyText(body.input, deps, { timezone, onEvent: send, signal: req.signal });
        // Privacy: log a hash and counts, never the user's text.
        console.info(`[veritas] ${fnv1a(report.input)} claims=${report.claims.length} verdicts=${report.claims.map((c) => c.verdict).join(",")} ms=${Date.now() - started}`);
      } catch (err) {
        const code = err instanceof VeritasError ? err.code : "INTERNAL";
        const message = err instanceof VeritasError ? err.message : "Verification failed unexpectedly.";
        if (!(err instanceof VeritasError)) console.error("[veritas] unexpected error", err);
        send({ type: "error", code, message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
