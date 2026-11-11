/**
 * Deterministic signal extraction: raw source data → typed, explainable
 * Signals with evidence. The AI only ever reasons over these — it never sees
 * (or invents) facts that a rule here didn't produce.
 *
 * When the traveller gives a time of day, each airport gets a time window
 * (departure window at the origin, estimated arrival window at the
 * destination). Evidence inside the window keeps its severity; evidence
 * elsewhere in the day is one level less severe and tagged "outside".
 */
import type { FaaData, FaaEvent } from "./sources/faa.js";
import { FAA_NAME, FAA_URL } from "./sources/faa.js";
import type { NwsAirportData, NwsAlert, NwsPeriod } from "./sources/nws.js";
import { NWS_NAME } from "./sources/nws.js";
import type { Taf, TafGroup } from "./sources/awc.js";
import { AWC_NAME } from "./sources/awc.js";
import type { OpenMeteoDay, OpenMeteoHour } from "./sources/openMeteo.js";
import { OPEN_METEO_NAME, describeWeatherCode } from "./sources/openMeteo.js";
import type { Airport, Evidence, Severity, Signal, SignalKind, SourceId } from "./types.js";
import { formatLocalTime } from "./travelWindow.js";

export interface SignalInput {
  date: string; // YYYY-MM-DD, travel date (local to each airport)
  daysAhead: number;
  airports: Airport[];
  now?: Date;
  faa?: { data: FaaData; fetchedAt: string };
  nws: Map<string, NwsAirportData>;
  tafs?: { url: string; data: Map<string, Taf>; fetchedAt: string };
  openMeteo: Map<string, OpenMeteoDay>;
  /** Per-airport UTC [start, end) travel windows; absent when "any time". */
  windows?: Map<string, [number, number]>;
}

type Draft = Omit<Signal, "id">;

const HOUR = 3600_000;
const clamp = (n: number): Severity => Math.max(0, Math.min(3, n)) as Severity;
const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

/** UTC [start, end) ms of the travel date in the airport's local time. */
export function localDayWindow(date: string, utcOffsetSeconds: number): [number, number] {
  const [y, m, d] = date.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d) - utcOffsetSeconds * 1000;
  return [start, start + 24 * HOUR];
}

/** Shared per-request context: offsets, spans, and window placement. */
class Ctx {
  readonly offsets = new Map<string, number>();
  constructor(readonly input: SignalInput) {
    for (const a of input.airports) {
      // Open-Meteo knows the local offset; otherwise approximate from longitude.
      this.offsets.set(a.iata, input.openMeteo.get(a.iata)?.utcOffsetSeconds ?? Math.round(a.lon / 15) * 3600);
    }
  }
  offset(iata: string) {
    return this.offsets.get(iata) ?? 0;
  }
  day(iata: string) {
    return localDayWindow(this.input.date, this.offset(iata));
  }
  window(iata: string) {
    return this.input.windows?.get(iata);
  }
  /** Time range to pull data for: the travel date, extended to cover the window (overnight, late arrivals). */
  span(iata: string): [number, number] {
    const [d0, d1] = this.day(iata);
    const w = this.window(iata);
    return w ? [Math.min(d0, w[0]), Math.max(d1, w[1])] : [d0, d1];
  }
  /** Where a piece of evidence sits relative to the traveller's window. */
  place(iata: string, start: number, end: number): { adj: number; window?: "inside" | "outside"; note: string } {
    const w = this.window(iata);
    if (!w) return { adj: 0, note: "" };
    if (overlaps(start, end, w[0], w[1])) return { adj: 0, window: "inside", note: "" };
    return { adj: -1, window: "outside", note: ", outside your travel window" };
  }
  localRange(iata: string, start: number, end: number) {
    return `${formatLocalTime(start, this.offset(iata))}–${formatLocalTime(end, this.offset(iata))} local`;
  }
}

/** Keep the most severe draft per kind (inside-window wins ties). */
function bestPerKind(drafts: Draft[]): Draft[] {
  const best = new Map<SignalKind, Draft>();
  for (const d of drafts) {
    const prev = best.get(d.kind);
    if (!prev || d.severity > prev.severity || (d.severity === prev.severity && d.window === "inside" && prev.window !== "inside")) {
      best.set(d.kind, d);
    }
  }
  return [...best.values()];
}

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

function faaSignals(ctx: Ctx): Draft[] {
  const { input } = ctx;
  if (!input.faa) return [];
  const iatas = new Set(input.airports.map((a) => a.iata));
  const out: Draft[] = [];
  const evidence = (e: FaaEvent): Evidence => ({
    source: "faa",
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
      const [s0, s1] = ctx.span(e.airport);
      if (win && !overlaps(win[0], win[1], s0, s1)) continue;
      const hours = win ? (win[1] - win[0]) / HOUR : null;
      // Short overnight closures are routine; multi-hour daytime ones are not.
      const base = hours !== null && hours <= 8 ? 1 : 2;
      const p = win ? ctx.place(e.airport, win[0], win[1]) : { adj: 0, window: undefined, note: "" };
      out.push({
        airport: e.airport,
        kind: "closure",
        severity: clamp(base + p.adj),
        summary: `FAA-published closure at ${e.airport} overlaps your travel date${p.note}`,
        timing: "forecast",
        window: p.window,
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

function nwsAlertSignals(ctx: Ctx, nws: NwsAirportData): Draft[] {
  const [s0, s1] = ctx.span(nws.airport);
  const out: Draft[] = [];
  const seen = new Set<string>();
  for (const a of nws.alerts) {
    if (IRRELEVANT_ALERT.test(a.event) || seen.has(a.event)) continue;
    const start = Date.parse(a.onset ?? a.effective ?? "") || Date.now();
    const end = Date.parse(a.ends ?? a.expires ?? "") || Infinity;
    if (!overlaps(start, end, s0, s1)) continue;
    seen.add(a.event);
    const p = ctx.place(nws.airport, start, end);
    out.push({
      airport: nws.airport,
      kind: "nws_alert",
      severity: clamp(alertSeverity(a) + p.adj),
      summary: `${a.event} in effect near ${nws.airport}${p.note}`,
      timing: "forecast",
      window: p.window,
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

/** -1 when the phrase mentioning `subject` is hedged as a "slight chance" (e.g. "rain and a slight chance of thunderstorms"). */
export function chanceFactor(text: string, subject: RegExp): number {
  const sentence = text.split(/\.\s/).find((s) => subject.test(s)) ?? "";
  const before = sentence.slice(0, sentence.search(subject));
  return /slight chance/i.test(before) && !/likely/i.test(sentence) ? -1 : 0;
}

/** NWS periods (day/night halves) overlapping the airport's span. */
function relevantPeriods(ctx: Ctx, nws: NwsAirportData): NwsPeriod[] {
  const [s0, s1] = ctx.span(nws.airport);
  return nws.periods.filter((p) => overlaps(Date.parse(p.startTime), Date.parse(p.endTime) || Date.parse(p.startTime) + 12 * HOUR, s0, s1));
}

function nwsForecastSignals(ctx: Ctx, nws: NwsAirportData): Draft[] {
  const drafts: Draft[] = [];
  for (const p of relevantPeriods(ctx, nws)) {
    const text = `${p.shortForecast}. ${p.detailedForecast}`;
    const pStart = Date.parse(p.startTime);
    const pEnd = Date.parse(p.endTime) || pStart + 12 * HOUR;
    const pl = ctx.place(nws.airport, pStart, pEnd);
    const ev: Evidence = {
      source: "nws",
      sourceName: `${NWS_NAME} forecast`,
      url: nws.forecastUrl ?? "https://api.weather.gov",
      observedAt: nws.fetchedAt,
      excerpt: `${p.name}: ${p.detailedForecast}`,
    };
    const add = (kind: SignalKind, sev: number, summary: string, hedge = 0) =>
      drafts.push({
        airport: nws.airport,
        kind,
        severity: clamp(sev + hedge + pl.adj),
        summary: `${summary} (${p.name}${hedge ? ", slight chance" : ""}${pl.note})`,
        timing: "forecast",
        window: pl.window,
        evidence: ev,
      });

    const thunder = /thunderstorm|t-storm/i;
    if (thunder.test(text)) add("thunderstorm", 2, `Thunderstorms forecast at ${nws.airport}`, chanceFactor(text, thunder));
    const snowy = /blizzard|heavy snow|ice storm|freezing rain|sleet|snow/i;
    if (snowy.test(p.shortForecast)) {
      add("snow_ice", /blizzard|heavy snow|ice storm|freezing rain/i.test(text) ? 3 : 2, `Snow/ice forecast at ${nws.airport}`, chanceFactor(text, snowy));
    }
    if (/fog/i.test(p.shortForecast)) add("low_visibility", /dense/i.test(text) ? 2 : 1, `Fog forecast at ${nws.airport}`);
    if (/heavy rain/i.test(text)) add("heavy_rain", 1, `Heavy rain forecast at ${nws.airport}`);
    const wind = maxWindMph(p);
    if (wind !== null && wind >= 35) add("high_wind", wind >= 45 ? 2 : 1, `Strong winds (up to ${wind} mph) forecast at ${nws.airport}`);
  }
  return bestPerKind(drafts);
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

function tafSignals(ctx: Ctx): Draft[] {
  const { input } = ctx;
  if (!input.tafs) return [];
  const out: Draft[] = [];
  for (const [iata, taf] of input.tafs.data) {
    const [s0, s1] = ctx.span(iata);
    const drafts: Draft[] = [];
    for (const g of taf.fcsts) {
      const g0 = g.timeFrom * 1000;
      const g1 = g.timeTo * 1000;
      if (!overlaps(g0, g1, s0, s1)) continue;
      // TEMPO/PROB groups are possibilities, not the prevailing forecast.
      const possible = g.fcstChange === "TEMPO" || g.fcstChange === "PROB" || Boolean(g.probability);
      const pl = ctx.place(iata, g0, g1);
      const adj = (possible ? -1 : 0) + pl.adj;
      const ev: Evidence = {
        source: "awc",
        sourceName: AWC_NAME,
        url: `https://aviationweather.gov/api/data/taf?ids=${taf.icaoId}&format=raw`,
        observedAt: input.tafs.fetchedAt,
        excerpt: taf.rawTAF,
      };
      const add = (kind: SignalKind, sev: number, summary: string) =>
        drafts.push({
          airport: iata,
          kind,
          severity: clamp(sev + adj),
          summary: `${summary} (${ctx.localRange(iata, g0, g1)}${possible ? ", temporary/possible" : ""}${pl.note})`,
          timing: "forecast",
          window: pl.window,
          evidence: ev,
        });
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
    out.push(...bestPerKind(drafts));
  }
  return out;
}

// ---------------------------------------------------------------- Open-Meteo

interface WeatherSummary {
  airport: string;
  label: string; // "2026-11-12" or "5am–12pm local"
  codes: number[];
  precipitationMm: number | null;
  snowfallCm: number | null;
  windGustKt: number | null;
  precipProbabilityPct: number | null;
  window?: "inside" | "outside";
  adj: number;
  note: string;
}

function summariseHours(hours: OpenMeteoHour[]): Pick<WeatherSummary, "codes" | "precipitationMm" | "snowfallCm" | "windGustKt"> {
  const sum = (f: (h: OpenMeteoHour) => number | null) => Math.round(hours.reduce((s, h) => s + (f(h) ?? 0), 0) * 10) / 10;
  return {
    codes: hours.map((h) => h.weatherCode).filter((c): c is number => c !== null),
    precipitationMm: sum((h) => h.precipitationMm),
    snowfallCm: sum((h) => h.snowfallCm),
    windGustKt: hours.length ? Math.max(...hours.map((h) => h.windGustKt ?? 0)) : null,
  };
}

function openMeteoSignals(w: WeatherSummary, day: OpenMeteoDay): Draft[] {
  const out: Draft[] = [];
  const has = (codes: number[]) => w.codes.some((c) => codes.includes(c));
  const worst = w.codes.length ? Math.max(...w.codes) : null;
  const ev: Evidence = {
    source: "openMeteo",
    sourceName: OPEN_METEO_NAME,
    url: day.url,
    observedAt: day.fetchedAt,
    excerpt: `${w.label}: ${describeWeatherCode(worst)}; precip ${w.precipitationMm ?? "?"} mm${w.precipProbabilityPct !== null ? ` (max chance ${w.precipProbabilityPct}%)` : ""}, snowfall ${w.snowfallCm ?? "?"} cm, gusts up to ${w.windGustKt ?? "?"} kt`,
  };
  const push = (kind: SignalKind, severity: number, summary: string) =>
    out.push({ airport: w.airport, kind, severity: clamp(severity + w.adj), summary: `${summary}${w.note}`, timing: "forecast", window: w.window, evidence: ev });

  if (w.codes.some((c) => c >= 95)) push("thunderstorm", 2, `Open-Meteo model forecasts thunderstorms at ${w.airport}`);
  const snow = w.snowfallCm ?? 0;
  if (has([56, 57, 66, 67]) || snow > 0.5) {
    push("snow_ice", snow >= 15 ? 3 : snow >= 5 || has([66, 67]) ? 2 : 1, `Open-Meteo forecasts ${snow > 0 ? `${snow} cm snow` : "freezing precipitation"} at ${w.airport}`);
  }
  if (has([45, 48])) push("low_visibility", 1, `Open-Meteo forecasts fog at ${w.airport}`);
  if (has([65, 82]) || (w.precipitationMm ?? 0) >= 25) push("heavy_rain", 1, `Open-Meteo forecasts heavy rain (${w.precipitationMm} mm) at ${w.airport}`);
  const gust = w.windGustKt ?? 0;
  if (gust >= 30) push("high_wind", gust >= 40 ? 2 : 1, `Open-Meteo forecasts gusts up to ${gust} kt at ${w.airport}`);
  return out;
}

function openMeteoDrafts(ctx: Ctx, day: OpenMeteoDay): Draft[] {
  const iata = day.airport;
  const w = ctx.window(iata);
  if (!w || day.hours.length === 0) {
    // No time of day: use the daily summary for the travel date.
    return openMeteoSignals(
      { airport: iata, label: day.date, codes: day.weatherCode === null ? [] : [day.weatherCode], precipitationMm: day.precipitationMm, snowfallCm: day.snowfallCm, windGustKt: day.windGustKt, precipProbabilityPct: day.precipProbabilityPct, adj: 0, note: "" },
      day,
    );
  }
  // With a window: hours inside it at full severity, the rest of the day one level lower.
  const [d0, d1] = ctx.day(iata);
  const inside = day.hours.filter((h) => h.time >= w[0] && h.time < w[1]);
  const outside = day.hours.filter((h) => h.time >= d0 && h.time < d1 && !(h.time >= w[0] && h.time < w[1]));
  const insideDrafts = openMeteoSignals(
    { airport: iata, label: ctx.localRange(iata, w[0], w[1]), ...summariseHours(inside), precipProbabilityPct: null, window: "inside", adj: 0, note: "" },
    day,
  );
  const outsideDrafts = openMeteoSignals(
    { airport: iata, label: `${day.date}, rest of the day`, ...summariseHours(outside), precipProbabilityPct: null, window: "outside", adj: -1, note: ", outside your travel window" },
    day,
  ).filter((d) => !insideDrafts.some((i) => i.kind === d.kind));
  return [...insideDrafts, ...outsideDrafts];
}

// ---------------------------------------------------------------- combine

export function extractSignals(input: SignalInput): Signal[] {
  const ctx = new Ctx(input);
  const drafts: Draft[] = [...faaSignals(ctx), ...tafSignals(ctx)];
  for (const a of input.airports) {
    const nws = input.nws.get(a.iata);
    if (nws) drafts.push(...nwsAlertSignals(ctx, nws), ...nwsForecastSignals(ctx, nws));
    const om = input.openMeteo.get(a.iata);
    if (om) drafts.push(...openMeteoDrafts(ctx, om));
  }

  // Positive evidence: an airport with weather data and nothing adverse gets a
  // "fair weather" signal, so a low-risk verdict is also backed by evidence.
  for (const a of input.airports) {
    if (drafts.some((d) => d.airport === a.iata && d.severity > 0)) continue;
    const om = input.openMeteo.get(a.iata);
    const nws = input.nws.get(a.iata);
    const w = ctx.window(a.iata);
    const periods = nws ? relevantPeriods(ctx, nws) : [];
    const period = (w && periods.find((p) => overlaps(Date.parse(p.startTime), Date.parse(p.endTime), w[0], w[1]))) || periods[0];
    const base = { airport: a.iata, kind: "fair_weather" as const, severity: 0 as Severity, summary: `No significant weather forecast at ${a.iata}${w ? " during your travel window" : ""}`, timing: "forecast" as const, window: w ? ("inside" as const) : undefined };
    if (period && nws) {
      drafts.push({ ...base, evidence: { source: "nws", sourceName: `${NWS_NAME} forecast`, url: nws.forecastUrl ?? "https://api.weather.gov", observedAt: nws.fetchedAt, excerpt: `${period.name}: ${period.detailedForecast}` } });
    } else if (om) {
      drafts.push({ ...base, evidence: { source: "openMeteo" as SourceId, sourceName: OPEN_METEO_NAME, url: om.url, observedAt: om.fetchedAt, excerpt: `${om.date}: ${describeWeatherCode(om.weatherCode)}, gusts up to ${om.windGustKt ?? "?"} kt, precip ${om.precipitationMm ?? "?"} mm` } });
    }
  }

  drafts.sort((a, b) => b.severity - a.severity || a.airport.localeCompare(b.airport));
  return drafts.map((d, i) => ({ ...d, id: `S${i + 1}` }));
}
