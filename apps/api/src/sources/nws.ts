import type { Store } from "../store.js";
import type { Airport } from "../types.js";
import { cachedGetJson } from "./http.js";

export const NWS_NAME = "National Weather Service";

export interface NwsPeriod {
  name: string;
  startTime: string; // ISO with local offset, e.g. 2026-11-11T06:00:00-05:00
  endTime: string;
  isDaytime: boolean;
  shortForecast: string;
  detailedForecast: string;
  windSpeed: string;
  probabilityOfPrecipitation?: { value: number | null };
}

export interface NwsAlert {
  id: string;
  event: string;
  headline: string | null;
  severity: "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";
  certainty: string;
  urgency: string;
  onset: string | null;
  effective: string | null;
  ends: string | null;
  expires: string | null;
  description: string;
  areaDesc: string;
}

export interface NwsAirportData {
  airport: string;
  timeZone: string | null;
  forecastUrl: string | null;
  periods: NwsPeriod[];
  alertsUrl: string;
  alerts: NwsAlert[];
  fetchedAt: string;
}

interface PointsResponse {
  properties: { forecast: string | null; timeZone: string };
}
interface ForecastResponse {
  properties: { periods: NwsPeriod[] };
}
interface AlertsResponse {
  features: { id: string; properties: Omit<NwsAlert, "id"> }[];
}

const coord = (n: number) => n.toFixed(4);

export async function fetchNwsForAirport(store: Store, airport: Airport): Promise<NwsAirportData> {
  const point = `${coord(airport.lat)},${coord(airport.lon)}`;
  const alertsUrl = `https://api.weather.gov/alerts/active?point=${point}`;

  const [points, alerts] = await Promise.all([
    // Grid mapping basically never changes; cache a day.
    cachedGetJson<PointsResponse>(`https://api.weather.gov/points/${point}`, { store, ttlMs: 24 * 3600_000 }),
    cachedGetJson<AlertsResponse>(alertsUrl, { store, ttlMs: 10 * 60_000 }),
  ]);

  const forecastUrl = points.data.properties.forecast;
  let periods: NwsPeriod[] = [];
  let fetchedAt = alerts.fetchedAt;
  if (forecastUrl) {
    const fc = await cachedGetJson<ForecastResponse>(forecastUrl, { store, ttlMs: 15 * 60_000 });
    periods = fc.data.properties.periods;
    fetchedAt = fc.fetchedAt;
  }

  return {
    airport: airport.iata,
    timeZone: points.data.properties.timeZone ?? null,
    forecastUrl,
    periods,
    alertsUrl,
    alerts: alerts.data.features.map((f) => ({ ...f.properties, id: f.id })),
    fetchedAt,
  };
}
