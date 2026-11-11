/**
 * Deterministic signal extraction: raw source data → typed, explainable
 * Signals with evidence. The AI only ever reasons over these — it never sees
 * (or invents) facts that a rule here didn't produce.
 */
import type { FaaData, FaaEvent } from "./sources/faa.js";
import { FAA_NAME, FAA_URL } from "./sources/faa.js";
import type { NwsAirportData, NwsAlert, NwsPeriod } from "./sources/nws.js";
import { NWS_NAME } from "./sources/nws.js";
import type { Taf, TafGroup } from "./sources/awc.js";
import { AWC_NAME } from "./sources/awc.js";
import type { OpenMeteoDay } from "./sources/openMeteo.js";
import { OPEN_METEO_NAME, describeWeatherCode } from "./sources/openMeteo.js";
import type { Airport, Severity, Signal, SignalKind, SourceId } from "./types.js";

export interface SignalInput {
  date: string; // YYYY-MM-DD, travel date (local to each airport)
  daysAhead: number;
  airports: Airport[];
  now?: Date;
  faa?: { data: FaaData; fetchedAt: string };
  nws: Map<string, NwsAirportData>;
  tafs?: { url: string; data: Map<string, Taf>; fetchedAt: string };
  openMeteo: Map<string, OpenMeteoDay>;
}

type Draft = Omit<Signal, "id">;

const clamp = (n: number): Severity => Math.max(0, Math.min(3, n)) as Severity;

/** UTC [start, end) ms of the travel date in the airport's local time. */
export function localDayWindow(date: string, utcOffsetSeconds: number): [number, number] {
  const [y, m, d] = date.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d) - utcOffsetSeconds * 1000;
  return [start, start + 24 * 3600_000];
}

const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

// ---------------------------------------------------------------- FAA

/** NOTAM validity "2611100730-2611211415" (YYMMDDHHMM UTC) → ms window. */
export function parseNotamWindow(reason: string): [number, number] | null {
  const m = reason.match(/(\d{10})-(\d{10})/);
  if (!m) return null;
  const toMs = (s: string) =>
    Date.UTC(2000 + Number(s.slice(0, 2)), Number(s.slice(2, 4)) - 1, Number(s.slice(4, 6)), Number(s.slice(6, 8)), Number(s.slice(8, 10)));
  return [toMs(m[1]), toMs(m[2])];
}

/** Closures that only restrict private/GA aircraft don't affect airline passengers. */
export function isGaOnlyClosure(reason: string): boolean {
  // e.g. "AD AP CLSD TO NON SKED TRANSIENT GA ACFT" — closed only to private aircraft
  return /CLSD TO (NON[ -]?SKED|TRANSIENT|GA\b)/i.test(reason);
}

function faaSignals(input: SignalInput, offsets: Map<string, number>): Draft[] {
  if (!input.faa) return [];
  const iatas = new Set(input.airports.map((a) => a.iata));
  const out: Draft[] = [];
  const evidence = (e: FaaEvent) => ({
    source: "faa" as SourceId,
    sourceName: FAA_NAME,
    url: FAA_URL,
    observedAt: input.faa!.fetchedAt,
    excerpt: `${e.airport}: ${e.detail}${e.reason ? ` — reason: ${e.reason}` : ""}`,
  });
  // Current FAA programs matter for trips today/tomorrow; further out they are
  // only context (a ground stop now says nothing about next week).
  const nearTerm = input.daysAhead <= 1;

  for (const e of input.faa.data.events) {
    if (!iatas.has(e.airport)) continue;
    if (e.type === "closure") {
      if (isGaOnlyClosure(e.reason)) continue;
      const win = parseNotamWindow(e.reason);
      const [d0, d1] = localDayWindow(input.date, offsets.get(e.airport) ?? 0);
      if (win && !overlaps(win[0], win[1], d0, d1)) continue;
      const hours = win ? (win[1] - win[0]) / 3600_000 : null;
      // Short overnight closures are routine; multi-hour daytime ones are not.
      const severity = hours !== null && hours <= 8 ? 1 : 2;
      out.push({
        airport: e.airport,
        kind: "closure",
        severity: clamp(severity),
        summary: `FAA-published closure at ${e.airport} overlaps your travel date`,
        timing: "forecast",
        evidence: evidence(e),
      });
      continue;
    }

    let severity: number;
    let summary: string;
    let kind: SignalKind;
    if (e.type === "ground_stop") {
      kind = "ground_stop";
      severity = 3;
      summary = `Ground stop in effect at ${e.airport}`;
    } else if (e.type === "ground_delay") {
      kind = "ground_delay";
      severity = (e.minutes ?? 0) >= 60 ? 3 : (e.minutes ?? 0) >= 30 ? 2 : 1;
      summary = `Ground delay program at ${e.airport}${e.minutes ? ` (avg ${e.minutes} min)` : ""}`;
    } else {
      kind = "airport_delay";
      severity = (e.minutes ?? 0) >= 60 ? 2 : 1;
      summary = `Departure/arrival delays at ${e.airport}${e.minutes ? ` (up to ${e.minutes} min)` : ""}`;
    }
    out.push({
      airport: e.airport,
      kind,
      severity: clamp(nearTerm ? severity : 0),
      summary: nearTerm ? summary : `${summary} right now (current conditions, not your travel date)`,
      timing: "current",
      evidence: evidence(e),
    });
  }
  return out;
}

// ---------------------------------------------------------------- NWS

// Alerts that don't plausibly affect flights or getting to the airport.
const IRRELEVANT_ALERT = /marine|small craft|hazardous seas|surf|rip current|beach|gale|air quality|hydrologic|low water|lakeshore|fire weather|red flag|frost|freeze/i;

function alertSeverity(a: NwsAlert): number {
  const base = { Extreme: 3, Severe: 2, Moderate: 2, Minor: 1, Unknown: 1 }[a.severity] ?? 1;
  // Event types that most directly ground or slow flights
  if (/blizzard|ice storm|hurricane|tropical storm warning|tornado warning/i.test(a.event)) return 3;
  if (/winter storm|high wind warning|severe thunderstorm|dense fog/i.test(a.event)) return Math.max(base, 2);
  if (/heat|cold|wind chill|advisory/i.test(a.event)) return Math.min(base, 1);
  return base;
}

function nwsAlertSignals(input: SignalInput, nws: NwsAirportData, offset: number): Draft[] {
  const [d0, d1] = localDayWindow(input.date, offset);
  const out: Draft[] = [];
  const seen = new Set<string>();
  for (const a of nws.alerts) {
    if (IRRELEVANT_ALERT.test(a.event) || seen.has(a.event)) continue;
    const start = Date.parse(a.onset ?? a.effective ?? "") || Date.now();
    const end = Date.parse(a.ends ?? a.expires ?? "") || Infinity;
    if (!overlaps(start, end, d0, d1)) continue;
    seen.add(a.event);
    out.push({
      airport: nws.airport,
      kind: "nws_alert",
      severity: clamp(alertSeverity(a)),
      summary: `${a.event} in effect near ${nws.airport}`,
      timing: "forecast",
      evidence: {
        source: "nws",
        sourceName: `${NWS_NAME} alerts`,
        url: nws.alertsUrl,
        observedAt: nws.fetchedAt,
        excerpt: `${a.headline ?? a.event}. ${a.description.replace(/\s+/g, " ").slice(0, 400)}`,
      },
    });
  }
  return out;
}

/** Max gust (mph) mentioned in an NWS text forecast, else max sustained. */
export function maxWindMph(p: NwsPeriod): number | null {
  const gust = p.detailedForecast.match(/gusts? as high as (\d+) mph/i);
  if (gust) return Number(gust[1]);
  const nums = p.windSpeed.match(/\d+/g);
  return nums ? Math.max(...nums.map(Number)) : null;
}

function chanceFactor(text: string): number {
  if (/slight chance/i.test(text)) return -1;
  if (/chance/i.test(text) && !/likely/i.test(text)) return 0;
  return 0;
}

function nwsForecastSignals(input: SignalInput, nws: NwsAirportData): Draft[] {
  // NWS startTime carries the local offset, so its date part is the local date.
  const periods = nws.periods.filter((p) => p.startTime.slice(0, 10) === input.date);
  const best = new Map<SignalKind, Draft>();
  const consider = (d: Draft) => {
    const prev = best.get(d.kind);
    if (!prev || d.severity > prev.severity) best.set(d.kind, d);
  };
  for (const p of periods) {
    const text = `${p.shortForecast}. ${p.detailedForecast}`;
    const ev = {
      source: "nws" as SourceId,
      sourceName: `${NWS_NAME} forecast`,
      url: nws.forecastUrl ?? "https://api.weather.gov",
      observedAt: nws.fetchedAt,
      excerpt: `${p.name}: ${p.detailedForecast}`,
    };
    const adj = chanceFactor(p.shortForecast);
    if (/thunderstorm|t-storm/i.test(text)) {
      consider({ airport: nws.airport, kind: "thunderstorm", severity: clamp(2 + adj), summary: `Thunderstorms forecast at ${nws.airport} (${p.name})`, timing: "forecast", evidence: ev });
    }
    if (/blizzard|heavy snow|ice storm|freezing rain|sleet|snow/i.test(p.shortForecast)) {
      const heavy = /blizzard|heavy snow|ice storm|freezing rain/i.test(text);
      consider({ airport: nws.airport, kind: "snow_ice", severity: clamp((heavy ? 3 : 2) + adj), summary: `Snow/ice forecast at ${nws.airport} (${p.name})`, timing: "forecast", evidence: ev });
    }
    if (/fog/i.test(p.shortForecast)) {
      consider({ airport: nws.airport, kind: "low_visibility", severity: clamp(1 + (/dense/i.test(text) ? 1 : 0)), summary: `Fog forecast at ${nws.airport} (${p.name})`, timing: "forecast", evidence: ev });
    }
    if (/heavy rain/i.test(text)) {
      consider({ airport: nws.airport, kind: "heavy_rain", severity: 1, summary: `Heavy rain forecast at ${nws.airport} (${p.name})`, timing: "forecast", evidence: ev });
    }
    const wind = maxWindMph(p);
    if (wind !== null && wind >= 35) {
      consider({ airport: nws.airport, kind: "high_wind", severity: clamp(wind >= 45 ? 2 : 1), summary: `Strong winds (up to ${wind} mph) forecast at ${nws.airport}`, timing: "forecast", evidence: ev });
    }
  }
  return [...best.values()];
}

// ---------------------------------------------------------------- TAF

function tafCeilingFt(g: TafGroup): number | null {
  const layers = g.clouds.filter((c) => ["BKN", "OVC", "OVX"].includes(c.cover) && c.base !== null).map((c) => c.base!);
  if (g.vertVis !== null) layers.push(g.vertVis);
  return layers.length ? Math.min(...layers) : null;
}

function tafVisibilitySm(g: TafGroup): number | null {
  if (g.visib === null) return null;
  if (typeof g.visib === "number") return g.visib;
  return Number.parseFloat(g.visib.replace("+", "")) || null;
}

function tafSignals(input: SignalInput, offsets: Map<string, number>): Draft[] {
  if (!input.tafs) return [];
  const out: Draft[] = [];
  for (const [iata, taf] of input.tafs.data) {
    const [d0, d1] = localDayWindow(input.date, offsets.get(iata) ?? 0);
    const groups = taf.fcsts.filter((g) => overlaps(g.timeFrom * 1000, g.timeTo * 1000, d0, d1));
    const best = new Map<SignalKind, Draft>();
    for (const g of groups) {
      // TEMPO/PROB groups are possibilities, not the prevailing forecast.
      const adj = g.fcstChange === "TEMPO" || g.fcstChange === "PROB" || g.probability ? -1 : 0;
      const when = `${new Date(g.timeFrom * 1000).toISOString().slice(11, 16)}–${new Date(g.timeTo * 1000).toISOString().slice(11, 16)}Z`;
      const ev = {
        source: "awc" as SourceId,
        sourceName: AWC_NAME,
        url: `https://aviationweather.gov/api/data/taf?ids=${taf.icaoId}&format=raw`,
        observedAt: input.tafs.fetchedAt,
        excerpt: taf.rawTAF,
      };
      const add = (kind: SignalKind, sev: number, summary: string) => {
        const d = { airport: iata, kind, severity: clamp(sev + adj), summary: `${summary} (${when}${adj ? ", temporary/possible" : ""})`, timing: "forecast" as const, evidence: ev };
        const prev = best.get(kind);
        if (!prev || d.severity > prev.severity) best.set(kind, d);
      };
      const wx = g.wxString ?? "";
      if (/TS/.test(wx)) add("thunderstorm", 2, `Pilot forecast (TAF) shows thunderstorms at ${iata}`);
      if (/SN|FZ|PL|GS/.test(wx)) add("snow_ice", 2, `TAF shows snow/freezing precipitation at ${iata}`);
      const ceil = tafCeilingFt(g);
      const vis = tafVisibilitySm(g);
      if ((ceil !== null && ceil < 1000) || (vis !== null && vis < 3)) {
        const severe = (ceil !== null && ceil < 500) || (vis !== null && vis < 1);
        add("low_visibility", severe ? 3 : 2, `TAF shows low cloud/visibility at ${iata}${ceil !== null ? ` (ceiling ${ceil} ft)` : ""}${vis !== null ? ` (vis ${vis} SM)` : ""}`);
      }
      const wind = g.wgst ?? g.wspd;
      if (wind !== null && wind >= 25) add("high_wind", wind >= 35 ? 2 : 1, `TAF shows winds ${g.wspd ?? "?"}kt gusting ${g.wgst ?? "-"}kt at ${iata}`);
    }
    out.push(...best.values());
  }
  return out;
}

// ---------------------------------------------------------------- Open-Meteo

function openMeteoSignals(day: OpenMeteoDay): Draft[] {
  const out: Draft[] = [];
  const code = day.weatherCode;
  const desc = describeWeatherCode(code);
  const ev = {
    source: "openMeteo" as SourceId,
    sourceName: OPEN_METEO_NAME,
    url: day.url,
    observedAt: day.fetchedAt,
    excerpt: `${day.date}: ${desc}; precip ${day.precipitationMm ?? "?"} mm (max chance ${day.precipProbabilityPct ?? "?"}%), snowfall ${day.snowfallCm ?? "?"} cm, gusts up to ${day.windGustKt ?? "?"} kt`,
  };
  const push = (kind: SignalKind, severity: number, summary: string) =>
    out.push({ airport: day.airport, kind, severity: clamp(severity), summary, timing: "forecast", evidence: ev });

  if (code !== null && code >= 95) push("thunderstorm", 2, `Open-Meteo model forecasts ${desc} at ${day.airport}`);
  const snow = day.snowfallCm ?? 0;
  if ((code !== null && [56, 57, 66, 67].includes(code)) || snow > 0.5) {
    push("snow_ice", snow >= 15 ? 3 : snow >= 5 || [66, 67].includes(code ?? -1) ? 2 : 1, `Open-Meteo forecasts ${snow > 0 ? `${snow} cm snow` : desc} at ${day.airport}`);
  }
  if (code !== null && [45, 48].includes(code)) push("low_visibility", 1, `Open-Meteo forecasts fog at ${day.airport}`);
  if ((code !== null && [65, 82].includes(code)) || (day.precipitationMm ?? 0) >= 25) push("heavy_rain", 1, `Open-Meteo forecasts heavy rain (${day.precipitationMm} mm) at ${day.airport}`);
  const gust = day.windGustKt ?? 0;
  if (gust >= 30) push("high_wind", gust >= 40 ? 2 : 1, `Open-Meteo forecasts gusts up to ${gust} kt at ${day.airport}`);
  return out;
}

// ---------------------------------------------------------------- combine

export function extractSignals(input: SignalInput): Signal[] {
  // Local UTC offset per airport: Open-Meteo knows it; otherwise approximate from longitude.
  const offsets = new Map<string, number>();
  for (const a of input.airports) {
    offsets.set(a.iata, input.openMeteo.get(a.iata)?.utcOffsetSeconds ?? Math.round(a.lon / 15) * 3600);
  }

  const drafts: Draft[] = [...faaSignals(input, offsets), ...tafSignals(input, offsets)];
  for (const a of input.airports) {
    const nws = input.nws.get(a.iata);
    if (nws) drafts.push(...nwsAlertSignals(input, nws, offsets.get(a.iata)!), ...nwsForecastSignals(input, nws));
    const om = input.openMeteo.get(a.iata);
    if (om) drafts.push(...openMeteoSignals(om));
  }

  // Positive evidence: an airport with weather data and nothing adverse gets a
  // "fair weather" signal, so a low-risk verdict is also backed by evidence.
  for (const a of input.airports) {
    const adverse = drafts.some((d) => d.airport === a.iata && d.severity > 0);
    if (adverse) continue;
    const om = input.openMeteo.get(a.iata);
    const nws = input.nws.get(a.iata);
    const period = nws?.periods.find((p) => p.startTime.slice(0, 10) === input.date);
    if (period && nws) {
      drafts.push({ airport: a.iata, kind: "fair_weather", severity: 0, summary: `No significant weather forecast at ${a.iata}`, timing: "forecast", evidence: { source: "nws", sourceName: `${NWS_NAME} forecast`, url: nws.forecastUrl ?? "https://api.weather.gov", observedAt: nws.fetchedAt, excerpt: `${period.name}: ${period.detailedForecast}` } });
    } else if (om) {
      drafts.push({ airport: a.iata, kind: "fair_weather", severity: 0, summary: `No significant weather forecast at ${a.iata}`, timing: "forecast", evidence: { source: "openMeteo", sourceName: OPEN_METEO_NAME, url: om.url, observedAt: om.fetchedAt, excerpt: `${om.date}: ${describeWeatherCode(om.weatherCode)}, gusts up to ${om.windGustKt ?? "?"} kt, precip ${om.precipitationMm ?? "?"} mm` } });
    }
  }

  drafts.sort((a, b) => b.severity - a.severity || a.airport.localeCompare(b.airport));
  return drafts.map((d, i) => ({ ...d, id: `S${i + 1}` }));
}
