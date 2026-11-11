import type { Store } from "../store.js";
import type { Airport } from "../types.js";
import { cachedGetJson } from "./http.js";

export const OPEN_METEO_NAME = "Open-Meteo";

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
}

export function openMeteoUrl(airport: Airport, date: string) {
  const params = new URLSearchParams({
    latitude: airport.lat.toFixed(4),
    longitude: airport.lon.toFixed(4),
    daily:
      "weather_code,precipitation_sum,snowfall_sum,precipitation_probability_max,wind_gusts_10m_max,wind_speed_10m_max",
    wind_speed_unit: "kn",
    timezone: "auto",
    start_date: date,
    end_date: date,
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

export async function fetchOpenMeteoDay(store: Store, airport: Airport, date: string): Promise<OpenMeteoDay> {
  const url = openMeteoUrl(airport, date);
  const { data, fetchedAt } = await cachedGetJson<Response>(url, { store, ttlMs: 15 * 60_000 });
  const d = data.daily;
  return {
    airport: airport.iata,
    date,
    timezone: data.timezone,
    utcOffsetSeconds: data.utc_offset_seconds,
    weatherCode: d.weather_code[0] ?? null,
    precipitationMm: d.precipitation_sum[0] ?? null,
    snowfallCm: d.snowfall_sum[0] ?? null,
    precipProbabilityPct: d.precipitation_probability_max[0] ?? null,
    windGustKt: d.wind_gusts_10m_max[0] ?? null,
    windSpeedKt: d.wind_speed_10m_max[0] ?? null,
    url,
    fetchedAt,
  };
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
