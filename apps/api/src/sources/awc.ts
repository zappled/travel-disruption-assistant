import type { Store } from "../store.js";
import type { Airport } from "../types.js";
import { cachedGetJson } from "./http.js";

export const AWC_NAME = "Aviation Weather Center (TAF)";

export interface TafGroup {
  timeFrom: number; // unix seconds
  timeTo: number;
  fcstChange: "FM" | "BECMG" | "TEMPO" | "PROB" | null;
  probability: number | null;
  wspd: number | null; // knots
  wgst: number | null; // knots
  visib: string | number | null; // statute miles, "6+" for P6SM
  wxString: string | null;
  vertVis: number | null; // feet
  clouds: { cover: string; base: number | null }[];
}

export interface Taf {
  icaoId: string;
  rawTAF: string;
  issueTime: string;
  validTimeFrom: number;
  validTimeTo: number;
  fcsts: TafGroup[];
}

export function tafUrl(icaos: string[]) {
  return `https://aviationweather.gov/api/data/taf?ids=${icaos.join(",")}&format=json`;
}

/** One request for all airports; returns TAFs keyed by IATA. */
export async function fetchTafs(store: Store, airports: Airport[]) {
  const withIcao = airports.filter((a) => a.icao);
  const url = tafUrl(withIcao.map((a) => a.icao!));
  if (withIcao.length === 0) return { url, data: new Map<string, Taf>(), fetchedAt: new Date().toISOString() };

  const { data, fetchedAt } = await cachedGetJson<Taf[]>(url, { store, ttlMs: 15 * 60_000 });
  const byIcao = new Map(data.map((t) => [t.icaoId, t]));
  const out = new Map<string, Taf>();
  for (const a of withIcao) {
    const t = byIcao.get(a.icao!);
    if (t) out.set(a.iata, t);
  }
  return { url, data: out, fetchedAt };
}
