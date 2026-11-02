/**
 * LIVE evaluation — makes real Anthropic + search API calls (costs credits).
 *   npm run eval:live
 * Reports correct verdicts, incorrect verdicts (the dangerous kind) and
 * abstentions separately. A handful of cases is NOT evidence of general accuracy.
 */
import { verifyText } from "../../src/lib/veritas/engine";
import { createEngineDeps, serviceStatus } from "../../src/lib/veritas/factory";
import { liveCases } from "./expected";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* fall back to the existing environment */
}

const TIMEZONE = process.env.VERITAS_EVAL_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

async function main() {
  const deps = createEngineDeps();
  if (!deps) {
    console.error("ANTHROPIC_API_KEY is not set — live evaluation needs real credentials (see .env.example).");
    process.exit(1);
  }
  const status = serviceStatus();
  console.log(`Providers: LLM=${status.llm.smartModel}/${status.llm.fastModel} web=${status.webSearch ?? "none"} wikipedia=${status.wikipedia} factcheck=${status.factCheck}`);
  // Fresh caches so every case is actually re-verified.
  deps.resultCache = undefined;
  deps.searchCache = undefined;

  const cases = liveCases(new Date(), TIMEZONE);
  let correct = 0;
  let incorrect = 0;
  let abstained = 0;
  const rows: string[] = [];

  for (const c of cases) {
    const t0 = Date.now();
    try {
      const report = await verifyText(c.input, deps, { timezone: TIMEZONE });
      const r = report.claims[0];
      let outcome: "correct" | "incorrect" | "abstained";
      if (c.expect === "UNVERIFIED") {
        // Any UNVERIFIED is the right call here; an unexpected reason code is reported but not penalised.
        outcome = r.verdict === "UNVERIFIED" ? "correct" : "incorrect";
        if (outcome === "correct" && c.reason && !c.reason.includes(r.reasonCode)) console.log(`    (note: reason ${r.reasonCode}, expected one of ${c.reason.join("/")})`);
      } else if (r.verdict === c.expect) outcome = "correct";
      else if (r.verdict === "UNVERIFIED") outcome = "abstained";
      else outcome = "incorrect";
      if (outcome === "correct") correct++;
      else if (outcome === "incorrect") incorrect++;
      else abstained++;
      const mark = outcome === "correct" ? "✔" : outcome === "abstained" ? "–" : "✖";
      rows.push(
        `${mark} [${r.verdict}${r.verdict === "UNVERIFIED" ? "/" + r.reasonCode : ""} · ${r.evidenceStrength}] expected ${c.expect}  ${((Date.now() - t0) / 1000).toFixed(1)}s  "${c.input}"` +
          (outcome !== "correct" ? `\n    ↳ ${r.explanation}${r.gateNote ? `\n    ↳ gate: ${r.gateNote}` : ""}` : ""),
      );
      console.log(rows.at(-1));
    } catch (err) {
      incorrect++;
      rows.push(`✖ ERROR "${c.input}": ${(err as Error).message}`);
      console.log(rows.at(-1));
    }
  }

  const n = cases.length;
  console.log(`\n${n} cases · ${correct} correct · ${incorrect} incorrect · ${abstained} abstained (UNVERIFIED when a verdict was expected)`);
  console.log(`Decided accuracy: ${correct}/${n - abstained} · Coverage: ${n - abstained}/${n}`);
  console.log("Note: this is a small smoke-test set; it does not establish real-world accuracy.");
  process.exit(incorrect > 0 ? 1 : 0);
}

main();
