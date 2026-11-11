/**
 * Dev helper: run the live data-gathering step without the AI.
 * Usage: npx tsx scripts/probe.ts <origin> <destination> [YYYY-MM-DD] [morning|afternoon|evening|overnight]
 */
import { resolveAirports } from "../src/airports.js";
import { gather } from "../src/gather.js";
import { MemoryStore } from "../src/store.js";
import type { TimeOfDay } from "../src/types.js";

const args = process.argv.slice(2);
const [origin = "New York", destination = "San Francisco"] = args;
const date = args[2] ?? new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
const timeOfDay = (args[3] as TimeOfDay | undefined) ?? null;

const resolve = (q: string) => {
  const r = resolveAirports(q);
  if (r.kind !== "resolved") throw new Error(`${q}: ${r.kind}`);
  return r.airports;
};
const route = { origin: resolve(origin), destination: resolve(destination) };
const daysAhead = Math.round((Date.parse(date) - Date.parse(new Date().toISOString().slice(0, 10))) / 86400_000);

const started = Date.now();
const { signals, sources, travelWindow } = await gather(new MemoryStore(), route, date, daysAhead, timeOfDay);
console.log(`${origin} → ${destination} on ${date} (+${daysAhead}d) in ${Date.now() - started}ms`);
console.log(travelWindow ? `Window: ${travelWindow.description}\n` : "Window: any time\n");
for (const s of sources) console.log(`[${s.status}] ${s.name}${s.detail ? ` — ${s.detail}` : ""}`);
console.log();
for (const s of signals) {
  console.log(`${s.id} sev${s.severity} ${s.airport} ${s.kind}${s.window ? ` [${s.window}]` : ""} (${s.evidence.source}) ${s.summary}`);
}
