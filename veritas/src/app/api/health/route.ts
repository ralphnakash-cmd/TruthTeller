import { serviceStatus } from "@/lib/veritas/factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which evidence sources are configured. Exposes booleans only — never keys. */
export function GET() {
  return Response.json(serviceStatus());
}
