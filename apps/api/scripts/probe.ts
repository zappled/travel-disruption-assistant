/**
 * Dev helper: run the live data-gathering step without the AI.
 * Usage: npx tsx scripts/probe.ts <origin> <destination> [YYYY-MM-DD]
 */
import { resolveAirports } from "../src/airports.js";
import { gather } from "../src/gather.js";
import { MemoryStore } from "../src/store.js";

const [origin = "New York", destination = "San Francisco", date = new Date(Date.now() + 86400_000).toISOString().slice(0, 10)] =
  process.argv.slice(2);

const airports = [origin, destination].flatMap((q) => {
  const r = resolveAirports(q);
  if (r.kind !== "resolved") throw new Error(`${q}: ${r.kind}`);
  return r.airports;
});
const daysAhead = Math.round((Date.parse(date) - Date.parse(new Date().toISOString().slice(0, 10))) / 86400_000);

const started = Date.now();
const { signals, sources } = await gather(new MemoryStore(), airports, date, daysAhead);
console.log(`${airports.map((a) => a.iata).join(",")} on ${date} (+${daysAhead}d) in ${Date.now() - started}ms\n`);
for (const s of sources) console.log(`[${s.status}] ${s.name}${s.detail ? ` — ${s.detail}` : ""}`);
console.log();
for (const s of signals) console.log(`${s.id} sev${s.severity} ${s.airport} ${s.kind} [${s.evidence.source}] ${s.summary}`);
