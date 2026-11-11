import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Airport } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const AIRPORTS: Airport[] = JSON.parse(
  readFileSync(path.join(here, "..", "data", "airports.json"), "utf8"),
);
const byIata = new Map(AIRPORTS.map((a) => [a.iata, a]));

/**
 * Metro areas served by several major airports. A traveller saying "New York"
 * could fly from any of these, and conditions can differ between them.
 */
const METROS: Record<string, string[]> = {
  "new york": ["JFK", "LGA", "EWR"],
  "new york city": ["JFK", "LGA", "EWR"],
  nyc: ["JFK", "LGA", "EWR"],
  chicago: ["ORD", "MDW"],
  "washington": ["DCA", "IAD", "BWI"],
  "washington dc": ["DCA", "IAD", "BWI"],
  "washington d.c.": ["DCA", "IAD", "BWI"],
  dc: ["DCA", "IAD", "BWI"],
  "san francisco": ["SFO", "OAK", "SJC"],
  "bay area": ["SFO", "OAK", "SJC"],
  sf: ["SFO", "OAK", "SJC"],
  "los angeles": ["LAX", "BUR", "LGB", "SNA"],
  la: ["LAX", "BUR", "LGB", "SNA"],
  houston: ["IAH", "HOU"],
  dallas: ["DFW", "DAL"],
  "dallas fort worth": ["DFW", "DAL"],
  miami: ["MIA", "FLL"],
  boston: ["BOS"],
  "honolulu": ["HNL"],
};

const norm = (s: string) =>
  s.toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();

const SIZE_RANK = { large: 0, medium: 1, small: 2 } as const;

export type Resolution =
  | { kind: "resolved"; airports: Airport[] }
  | { kind: "ambiguous"; candidates: Airport[] }
  | { kind: "not_found" };

/**
 * Resolve free-form user input ("JFK", "New York", "Portland, ME") to airports.
 * Never guesses silently: if a city name matches airports in more than one
 * state, the caller must ask the user to pick.
 */
export function resolveAirports(input: string): Resolution {
  const raw = input.trim();
  if (!raw) return { kind: "not_found" };

  // 1. Exact IATA code ("sfo", "SFO") or ICAO ("KSFO")
  const upper = raw.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper) && byIata.has(upper)) {
    return { kind: "resolved", airports: [byIata.get(upper)!] };
  }
  if (/^[A-Z]{4}$/.test(upper)) {
    const a = AIRPORTS.find((x) => x.icao === upper);
    if (a) return { kind: "resolved", airports: [a] };
  }
  // "San Francisco (SFO)" style
  const paren = raw.match(/\(([A-Za-z]{3})\)/);
  if (paren && byIata.has(paren[1].toUpperCase())) {
    return { kind: "resolved", airports: [byIata.get(paren[1].toUpperCase())!] };
  }

  // 2. Optional ", ST" state qualifier
  let q = norm(raw);
  let state: string | null = null;
  const stateMatch = raw.match(/,\s*([A-Za-z]{2})\s*$/);
  if (stateMatch) {
    state = stateMatch[1].toUpperCase();
    q = norm(raw.slice(0, stateMatch.index));
  }

  // 3. Known multi-airport metro
  if (!state && METROS[q]) {
    return { kind: "resolved", airports: METROS[q].map((c) => byIata.get(c)!).filter(Boolean) };
  }

  // 4. City name match against the dataset
  let matches = AIRPORTS.filter((a) => {
    const city = norm(a.city);
    return city === q || city.split(" ")[0] === q || city.startsWith(`${q} `);
  });
  if (state) matches = matches.filter((a) => a.region === state);
  if (matches.length === 0) {
    // Fall back to a substring match on the airport name ("O'Hare", "LaGuardia")
    matches = AIRPORTS.filter((a) => norm(a.name).includes(q));
    if (state) matches = matches.filter((a) => a.region === state);
  }
  if (matches.length === 0) return { kind: "not_found" };

  matches.sort((a, b) => SIZE_RANK[a.size] - SIZE_RANK[b.size]);
  const regions = new Set(matches.map((a) => a.region));
  if (regions.size > 1) {
    // e.g. "Portland" → PDX (OR) and PWM (ME). Offer the main airport per region.
    const best = [...regions].map((r) => matches.find((a) => a.region === r)!);
    return { kind: "ambiguous", candidates: best.slice(0, 8) };
  }
  // Same region: keep the biggest airport(s) only — small fields add noise.
  const topSize = matches[0].size;
  return { kind: "resolved", airports: matches.filter((a) => a.size === topSize).slice(0, 3) };
}

export function getAirport(iata: string): Airport | undefined {
  return byIata.get(iata.toUpperCase());
}
