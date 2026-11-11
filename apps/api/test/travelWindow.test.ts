import { describe, expect, it } from "vitest";
import { getAirport } from "../src/airports.js";
import { chanceFactor, extractSignals, localDayWindow, type SignalInput } from "../src/signals.js";

describe("chanceFactor", () => {
  const thunder = /thunderstorm/i;
  it("lowers severity only when the thunderstorm phrase itself is a slight chance", () => {
    expect(chanceFactor("A chance of rain, then rain and a slight chance of thunderstorms. Cloudy.", thunder)).toBe(-1);
    expect(chanceFactor("Slight chance of rain. Showers and thunderstorms likely.", thunder)).toBe(0);
    expect(chanceFactor("Thunderstorms. Heavy rain.", thunder)).toBe(0);
  });
});
import type { Taf, TafGroup } from "../src/sources/awc.js";
import type { OpenMeteoDay } from "../src/sources/openMeteo.js";
import { computeTravelWindow, estFlightHours, formatLocalTime } from "../src/travelWindow.js";
import type { Airport } from "../src/types.js";

const ap = (c: string) => getAirport(c)!;
const HOUR = 3600_000;
const OFFSETS: Record<string, number> = { JFK: -5 * 3600, SFO: -8 * 3600, DEN: -7 * 3600 };
const offsetOf = (a: Airport) => OFFSETS[a.iata] ?? 0;

describe("computeTravelWindow", () => {
  it("estimates flight time from distance", () => {
    expect(estFlightHours(ap("JFK"), ap("SFO"))).toBeGreaterThanOrEqual(5);
    expect(estFlightHours(ap("JFK"), ap("SFO"))).toBeLessThanOrEqual(6.5);
    expect(estFlightHours(ap("JFK"), ap("BOS"))).toBe(1);
  });

  it("builds a morning departure window in origin local time and shifts it for arrival", () => {
    const { window, perAirport } = computeTravelWindow("morning", "2026-11-12", [ap("JFK")], [ap("SFO")], offsetOf);
    const [d0, d1] = perAirport.get("JFK")!;
    // 5am–12pm New York (UTC-5) = 10:00–17:00 UTC
    expect(new Date(d0).toISOString()).toBe("2026-11-12T10:00:00.000Z");
    expect(new Date(d1).toISOString()).toBe("2026-11-12T17:00:00.000Z");
    const [a0] = perAirport.get("SFO")!;
    expect(a0 - d0).toBe(window.estFlightHours * HOUR);
    expect(window.description).toMatch(/^Departing JFK 5am–12pm local; arriving SFO about/);
  });

  it("runs overnight windows into the next day", () => {
    const { perAirport } = computeTravelWindow("overnight", "2026-11-12", [ap("SFO")], [ap("JFK")], offsetOf);
    const [d0, d1] = perAirport.get("SFO")!;
    expect(formatLocalTime(d0, OFFSETS.SFO)).toBe("10pm");
    expect(formatLocalTime(d1, OFFSETS.SFO)).toBe("5am");
    expect(d1 - d0).toBe(7 * HOUR);
  });
});

describe("time-of-day weighting in signals", () => {
  const date = "2026-11-12";
  const [den0] = localDayWindow(date, OFFSETS.DEN);
  const group = (fromHour: number, toHour: number, over: Partial<TafGroup> = {}): TafGroup => ({
    timeFrom: (den0 + fromHour * HOUR) / 1000, timeTo: (den0 + toHour * HOUR) / 1000,
    fcstChange: "FM", probability: null, wspd: 8, wgst: null, visib: "6+", wxString: null, vertVis: null, clouds: [], ...over,
  });
  const taf: Taf = {
    icaoId: "KDEN", rawTAF: "TAF KDEN ...", issueTime: "", validTimeFrom: 0, validTimeTo: 0,
    // Afternoon thunderstorms in Denver, 2pm–6pm local
    fcsts: [group(0, 14), group(14, 18, { wxString: "TSRA" }), group(18, 30)],
  };
  const base = (windows?: Map<string, [number, number]>): SignalInput => ({
    date, daysAhead: 0, airports: [ap("DEN")], nws: new Map(),
    openMeteo: new Map([["DEN", { utcOffsetSeconds: OFFSETS.DEN, hours: [] } as unknown as OpenMeteoDay]]),
    tafs: { url: "u", data: new Map([["DEN", taf]]), fetchedAt: "t" },
    windows,
  });
  const storm = (input: SignalInput) => extractSignals(input).find((s) => s.kind === "thunderstorm")!;

  it("keeps full severity with no time of day", () => {
    expect(storm(base())).toMatchObject({ severity: 2 });
    expect(storm(base()).window).toBeUndefined();
  });

  it("keeps full severity when storms fall inside the window", () => {
    const s = storm(base(new Map([["DEN", [den0 + 12 * HOUR, den0 + 17 * HOUR]]])));
    expect(s).toMatchObject({ severity: 2, window: "inside" });
  });

  it("lowers severity and says so when storms are outside the window", () => {
    const s = storm(base(new Map([["DEN", [den0 + 5 * HOUR, den0 + 12 * HOUR]]])));
    expect(s).toMatchObject({ severity: 1, window: "outside" });
    expect(s.summary).toMatch(/outside your travel window/);
    expect(s.summary).toMatch(/2pm–6pm local/);
  });

  it("uses Open-Meteo hourly data inside the window", () => {
    const hours = Array.from({ length: 48 }, (_, h) => ({
      time: den0 + h * HOUR,
      weatherCode: h >= 15 && h < 18 ? 95 : 1, // storms 3pm–6pm
      precipitationMm: 0, snowfallCm: 0, windGustKt: 10,
    }));
    const om = { airport: "DEN", date, timezone: "America/Denver", utcOffsetSeconds: OFFSETS.DEN, weatherCode: 95, precipitationMm: 0, snowfallCm: 0, precipProbabilityPct: 60, windGustKt: 10, windSpeedKt: 5, hours, url: "u", fetchedAt: "t" } as OpenMeteoDay;
    const input = (w: [number, number]): SignalInput => ({ date, daysAhead: 0, airports: [ap("DEN")], nws: new Map(), openMeteo: new Map([["DEN", om]]), windows: new Map([["DEN", w]]) });

    const morning = extractSignals(input([den0 + 5 * HOUR, den0 + 12 * HOUR])).find((s) => s.kind === "thunderstorm")!;
    expect(morning).toMatchObject({ severity: 1, window: "outside" });
    const afternoon = extractSignals(input([den0 + 12 * HOUR, den0 + 17 * HOUR])).find((s) => s.kind === "thunderstorm")!;
    expect(afternoon).toMatchObject({ severity: 2, window: "inside" });
    expect(afternoon.evidence.excerpt).toMatch(/^12pm–5pm local: thunderstorm/);
  });
});
