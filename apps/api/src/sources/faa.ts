import { XMLParser } from "fast-xml-parser";
import type { Store } from "../store.js";
import { cachedGet } from "./http.js";

export const FAA_URL = "https://nasstatus.faa.gov/api/airport-status-information";
export const FAA_NAME = "FAA National Airspace System Status";

export type FaaEventType = "ground_stop" | "ground_delay" | "airport_delay" | "closure";

export interface FaaEvent {
  airport: string; // IATA (FAA uses 3-letter LIDs, which match IATA for commercial airports)
  type: FaaEventType;
  reason: string;
  /** Human-readable detail, e.g. "avg 45 minutes, max 1 hour 30 minutes" */
  detail: string;
  /** Delay magnitude in minutes where known (avg for GDPs, max for general delays) */
  minutes: number | null;
  /** Closures only: UTC window strings as published */
  start?: string;
  end?: string;
}

export interface FaaData {
  updated: string;
  events: FaaEvent[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  // Lists of one element must still be arrays.
  isArray: (name) =>
    ["Delay_type", "Ground_Delay", "Program", "Delay", "Airport", "Arrival_Departure"].includes(name),
});

/** "1 hour and 15 minutes" → 75; "45 minutes" → 45 */
export function parseMinutes(text: unknown): number | null {
  if (typeof text !== "string" && typeof text !== "number") return null;
  const s = String(text).toLowerCase();
  const h = s.match(/(\d+)\s*hour/);
  const m = s.match(/(\d+)\s*min/);
  if (!h && !m) return null;
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());

export function parseFaaXml(xml: string): FaaData {
  const doc = parser.parse(xml)?.AIRPORT_STATUS_INFORMATION ?? {};
  const events: FaaEvent[] = [];

  for (const dt of doc.Delay_type ?? []) {
    for (const g of dt.Ground_Delay_List?.Ground_Delay ?? []) {
      const avg = parseMinutes(g.Avg);
      events.push({
        airport: str(g.ARPT),
        type: "ground_delay",
        reason: str(g.Reason),
        detail: `Ground delay program: average ${str(g.Avg) || "?"}, max ${str(g.Max) || "?"}`,
        minutes: avg,
      });
    }
    for (const p of dt.Ground_Stop_List?.Program ?? []) {
      events.push({
        airport: str(p.ARPT),
        type: "ground_stop",
        reason: str(p.Reason),
        detail: `Ground stop${p.End_Time ? ` until ${str(p.End_Time)}` : ""}`,
        minutes: null,
      });
    }
    for (const d of dt.Arrival_Departure_Delay_List?.Delay ?? []) {
      for (const ad of d.Arrival_Departure ?? []) {
        const max = parseMinutes(ad.Max);
        events.push({
          airport: str(d.ARPT),
          type: "airport_delay",
          reason: str(d.Reason),
          detail: `${str(ad.Type) || "General"} delays ${str(ad.Min)}–${str(ad.Max)}${ad.Trend ? `, ${str(ad.Trend).toLowerCase()}` : ""}`,
          minutes: max,
        });
      }
    }
    for (const a of dt.Airport_Closure_List?.Airport ?? []) {
      events.push({
        airport: str(a.ARPT),
        type: "closure",
        reason: str(a.Reason),
        detail: `Closure from ${str(a.Start)} to ${str(a.Reopen)}`,
        minutes: null,
        start: str(a.Start),
        end: str(a.Reopen),
      });
    }
  }
  return { updated: str(doc.Update_Time), events };
}

export async function fetchFaa(store: Store) {
  const { body, fetchedAt } = await cachedGet(FAA_URL, {
    store,
    ttlMs: 2 * 60_000,
    accept: "application/xml",
  });
  return { data: parseFaaXml(body), fetchedAt };
}
