/**
 * Turns "morning" etc. into concrete UTC time windows per airport:
 * the departure window at the origin, and an estimated arrival window at the
 * destination (departure window shifted by an estimated flight time).
 */
import { TIME_WINDOWS, type Airport, type TimeOfDay, type TravelWindow } from "./types.js";

const HOUR = 3600_000;

/** Great-circle distance in km. */
export function distanceKm(a: Airport, b: Airport): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Rough block time: ~800 km/h cruise plus 30 min for taxi/climb, rounded to 0.5h. */
export function estFlightHours(a: Airport, b: Airport): number {
  return Math.max(1, Math.round((distanceKm(a, b) / 800 + 0.5) * 2) / 2);
}

/** "5am", "8:30pm" in a fixed UTC offset. */
export function formatLocalTime(ms: number, offsetSeconds: number): string {
  const d = new Date(ms + offsetSeconds * 1000);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

export interface WindowResult {
  window: TravelWindow;
  /** UTC [start, end) ms per airport IATA */
  perAirport: Map<string, [number, number]>;
}

export function computeTravelWindow(
  timeOfDay: TimeOfDay,
  date: string,
  origin: Airport[],
  destination: Airport[],
  offsetOf: (a: Airport) => number,
): WindowResult {
  const tw = TIME_WINDOWS[timeOfDay];
  const [y, m, d] = date.split("-").map(Number);
  const o = origin[0];
  const originMidnight = Date.UTC(y, m - 1, d) - offsetOf(o) * 1000;
  const departStart = originMidnight + tw.startHour * HOUR;
  const departEnd = originMidnight + tw.endHour * HOUR;
  const flight = estFlightHours(o, destination[0]);
  const arriveStart = departStart + flight * HOUR;
  const arriveEnd = departEnd + flight * HOUR;

  const perAirport = new Map<string, [number, number]>();
  for (const a of origin) perAirport.set(a.iata, [departStart, departEnd]);
  for (const a of destination) if (!perAirport.has(a.iata)) perAirport.set(a.iata, [arriveStart, arriveEnd]);

  const codes = (list: Airport[]) => list.map((a) => a.iata).join("/");
  const dest = destination[0];
  const nextDay = (start: number, end: number, off: number) =>
    new Date(end + off * 1000).getUTCDate() !== new Date(start + off * 1000).getUTCDate() ? " (next day)" : "";
  const description =
    `Departing ${codes(origin)} ${tw.range} local; ` +
    `arriving ${codes(destination)} about ${formatLocalTime(arriveStart, offsetOf(dest))}–${formatLocalTime(arriveEnd, offsetOf(dest))} local` +
    `${nextDay(departStart, arriveEnd, offsetOf(dest))} (≈${flight}h flight)`;

  return {
    window: {
      timeOfDay,
      departStart: new Date(departStart).toISOString(),
      departEnd: new Date(departEnd).toISOString(),
      arriveStart: new Date(arriveStart).toISOString(),
      arriveEnd: new Date(arriveEnd).toISOString(),
      estFlightHours: flight,
      description,
    },
    perAirport,
  };
}
