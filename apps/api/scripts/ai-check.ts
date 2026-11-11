/**
 * Dev helper: check the configured AI provider end to end (free-text parsing,
 * then a full assessment on live data).
 * Usage (from apps/api): npx tsx --env-file=.env scripts/ai-check.ts ["trip description"]
 */
import { getProviderState } from "../src/ai/client.js";
import { parseTripText } from "../src/ai/parse.js";
import { runAssessment } from "../src/assessment.js";
import { MemoryStore } from "../src/store.js";

const text = process.argv[2] ?? "Flying NYC to San Francisco tomorrow evening, connecting through Denver";
const today = new Date().toISOString().slice(0, 10);

const { auth, provider } = await getProviderState();
if (!provider) {
  console.log(`No AI provider configured (${auth}).`);
  process.exit(1);
}

console.log(`\n1. Parse: "${text}"`);
let t = Date.now();
const trip = await parseTripText(text, today);
console.log(`   ok in ${Date.now() - t}ms →`, trip);

if (!trip.origin || !trip.destination || !trip.date) {
  console.log("   Parse didn't produce origin, destination and date; skipping the assessment.");
  process.exit(1);
}

console.log(`\n2. Assess ${trip.origin} → ${trip.destination} on ${trip.date} (${trip.timeOfDay ?? "any time"})`);
t = Date.now();
const r = await runAssessment(new MemoryStore(), {
  origin: trip.origin,
  destination: trip.destination,
  date: trip.date,
  timeOfDay: trip.timeOfDay,
  notes: trip.notes,
});
const a = r.assessment;
console.log(`   done in ${Date.now() - t}ms, generatedBy=${a.generatedBy}${a.aiModel ? ` (${a.aiModel})` : ""}`);
if (r.route.travelWindow) console.log(`   window: ${r.route.travelWindow.description}`);
console.log(`   ${a.overallRisk.toUpperCase()} risk, ${a.confidence} confidence: ${a.headline}`);
console.log(`   ${a.summary}`);
console.log(`   confidence: ${a.confidenceReason}`);
for (const risk of a.risks) console.log(`   - ${risk.title} [${risk.airports.join(" ")}] ${risk.likelihood}/${risk.impact}, evidence ${risk.evidenceIds.join(",")}`);
for (const rec of a.recommendations) console.log(`   > (${rec.priority}) ${rec.action}`);
if (r.notices.length) console.log(`   notices: ${r.notices.join(" | ")}`);
console.log(`   ${r.signals.length} signals; sources: ${r.sources.map((s) => `${s.source}=${s.status}`).join(", ")}`);
