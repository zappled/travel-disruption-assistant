import type { Store } from "../store.js";
import type { Airport } from "../types.js";
import { cachedGetJson } from "./http.js";

export const OPEN_METEO_NAME = "Open-Meteo";

export interface OpenMeteoHour {
  time: number; // UTC ms
  weatherCode: number | null;
  precipitationMm: number | null;
  snowfallCm: number | null;
  windGustKt: number | null;
}

export interface OpenMeteoDay {
  airport: string;
  date: string;
  timezone: string;
  utcOffsetSeconds: number;
  weatherCode: number | null;
  precipitationMm: number | null;
  snowfallCm: number | null;
  precipProbabilityPct: number | null;
  windGustKt: number | null;
  windSpeedKt: number | null;
  /** Hourly data for the travel date and the following day (for overnight trips / late arrivals). */
  hours: OpenMeteoHour[];
  url: string;
  fetchedAt: string;
}

interface Response {
  timezone: string;
  utc_offset_seconds: number;
  daily: {
    time: string[];
    weather_code: (number | null)[];
    precipitation_sum: (number | null)[];
    snowfall_sum: (number | null)[];
    precipitation_probability_max: (number | null)[];
    wind_gusts_10m_max: (number | null)[];
    wind_speed_10m_max: (number | null)[];
  };
  hourly?: {
    time: string[]; // local time, e.g. 2026-11-12T05:00
    weather_code: (number | null)[];
    precipitation: (number | null)[];
    snowfall: (number | null)[];
    wind_gusts_10m: (number | null)[];
  };
}

function nextDate(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function openMeteoUrl(airport: Airport, date: string) {
  const params = new URLSearchParams({
    latitude: airport.lat.toFixed(4),
    longitude: airport.lon.toFixed(4),
    daily:
      "weather_code,precipitation_sum,snowfall_sum,precipitation_probability_max,wind_gusts_10m_max,wind_speed_10m_max",
    hourly: "weather_code,precipitation,snowfall,wind_gusts_10m",
    wind_speed_unit: "kn",
    timezone: "auto",
    start_date: date,
    end_date: nextDate(date),
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

export function parseOpenMeteo(airport: string, date: string, data: Response, url: string, fetchedAt: string): OpenMeteoDay {
  const d = data.daily;
  const i = Math.max(0, d.time.indexOf(date));
  const h = data.hourly;
  const offsetMs = data.utc_offset_seconds * 1000;
  const hours: OpenMeteoHour[] = h
    ? h.time.map((t, k) => ({
        time: Date.parse(`${t}:00Z`) - offsetMs,
        weatherCode: h.weather_code[k] ?? null,
        precipitationMm: h.precipitation[k] ?? null,
        snowfallCm: h.snowfall[k] ?? null,
        windGustKt: h.wind_gusts_10m[k] ?? null,
      }))
    : [];
  return {
    airport,
    date,
    timezone: data.timezone,
    utcOffsetSeconds: data.utc_offset_seconds,
    weatherCode: d.weather_code[i] ?? null,
    precipitationMm: d.precipitation_sum[i] ?? null,
    snowfallCm: d.snowfall_sum[i] ?? null,
    precipProbabilityPct: d.precipitation_probability_max[i] ?? null,
    windGustKt: d.wind_gusts_10m_max[i] ?? null,
    windSpeedKt: d.wind_speed_10m_max[i] ?? null,
    hours,
    url,
    fetchedAt,
  };
}

export async function fetchOpenMeteoDay(store: Store, airport: Airport, date: string): Promise<OpenMeteoDay> {
  const url = openMeteoUrl(airport, date);
  const { data, fetchedAt } = await cachedGetJson<Response>(url, { store, ttlMs: 15 * 60_000 });
  return parseOpenMeteo(airport.iata, date, data, url, fetchedAt);
}

/** WMO weather interpretation codes used by Open-Meteo. */
export function describeWeatherCode(code: number | null): string {
  if (code === null) return "unknown";
  const table: Record<number, string> = {
    0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
    45: "fog", 48: "depositing rime fog",
    51: "light drizzle", 53: "drizzle", 55: "dense drizzle",
    56: "light freezing drizzle", 57: "dense freezing drizzle",
    61: "slight rain", 63: "moderate rain", 65: "heavy rain",
    66: "light freezing rain", 67: "heavy freezing rain",
    71: "slight snow", 73: "moderate snow", 75: "heavy snow", 77: "snow grains",
    80: "slight rain showers", 81: "moderate rain showers", 82: "violent rain showers",
    85: "slight snow showers", 86: "heavy snow showers",
    95: "thunderstorm", 96: "thunderstorm with slight hail", 99: "thunderstorm with heavy hail",
  };
  return table[code] ?? `code ${code}`;
}
