import { describe, expect, it } from "vitest";
import { getAirport } from "../src/airports.js";
import { parseFaaXml, parseMinutes } from "../src/sources/faa.js";
import type { Taf } from "../src/sources/awc.js";
import type { NwsAirportData } from "../src/sources/nws.js";
import type { OpenMeteoDay } from "../src/sources/openMeteo.js";
import { extractSignals, isGaOnlyClosure, localDayWindow, parseNotamWindow, type SignalInput } from "../src/signals.js";

// Real response captured from nasstatus.faa.gov on 2026-11-11.
const REAL_FAA_XML = `<AIRPORT_STATUS_INFORMATION><Update_Time>Wed Nov 11 06:06:33 2026 GMT</Update_Time><Dtd_File>http://www.fly.faa.gov/AirportStatus.dtd</Dtd_File><Delay_type><Name>Airport Closures</Name><Airport_Closure_List><Airport><ARPT>PNS</ARPT><Reason>!PNS 11/017 PNS AD AP CLSD EXC HEL OPS 2611110600-2611111100</Reason><Start>Nov 11 at 06:00 UTC.</Start><Reopen>Nov 11 at 11:00 UTC.</Reopen></Airport><Airport><ARPT>SNA</ARPT><Reason>!SNA 11/008 SNA AD AP CLSD DLY 0730-1415 2611100730-2611211415</Reason><Start>Nov 10 at 07:30 UTC.</Start><Reopen>Nov 21 at 14:15 UTC.</Reopen></Airport></Airport_Closure_List></Delay_type><Delay_type><Name>Airport Closures</Name><Airport_Closure_List><Airport><ARPT>LAX</ARPT><Reason>!LAX 05/277 LAX AD AP CLSD TO NON SKED TRANSIENT GA ACFT EXC 24HR PPR CTC ATLANTIC AVIATION 310-258-9884 OR SIGNATURE AVIATION 310-410-9605 2605271826-2705281600</Reason><Start>May 27 at 18:26 UTC.</Start><Reopen>May 28 at 16:00 UTC.</Reopen></Airport></Airport_Closure_List></Delay_type></AIRPORT_STATUS_INFORMATION>`;

// Shape per the FAA AirportStatus DTD (ground delay + ground stop + general delay).
const FAA_DELAYS_XML = `<AIRPORT_STATUS_INFORMATION><Update_Time>now</Update_Time>
<Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List><Ground_Delay><ARPT>SFO</ARPT><Reason>low ceilings</Reason><Avg>1 hour and 12 minutes</Avg><Max>2 hours and 3 minutes</Max></Ground_Delay></Ground_Delay_List></Delay_type>
<Delay_type><Name>Ground Stops</Name><Ground_Stop_List><Program><ARPT>EWR</ARPT><Reason>thunderstorms</Reason><End_Time>8:00 pm EDT.</End_Time></Program></Ground_Stop_List></Delay_type>
<Delay_type><Name>General Arrival/Departure Delay Info</Name><Arrival_Departure_Delay_List><Delay><ARPT>JFK</ARPT><Reason>VOL:Volume</Reason><Arrival_Departure Type="Departure"><Min>16 minutes</Min><Max>30 minutes</Max><Trend>Increasing</Trend></Arrival_Departure></Delay></Arrival_Departure_Delay_List></Delay_type>
</AIRPORT_STATUS_INFORMATION>`;

const ap = (code: string) => getAirport(code)!;

function baseInput(over: Partial<SignalInput>): SignalInput {
  return { date: "2026-11-11", daysAhead: 0, airports: [], nws: new Map(), openMeteo: new Map(), ...over };
}

describe("FAA parsing", () => {
  it("parses minutes", () => {
    expect(parseMinutes("1 hour and 12 minutes")).toBe(72);
    expect(parseMinutes("45 minutes")).toBe(45);
    expect(parseMinutes("")).toBeNull();
  });

  it("parses the real closure feed", () => {
    const data = parseFaaXml(REAL_FAA_XML);
    expect(data.events.map((e) => e.airport)).toEqual(["PNS", "SNA", "LAX"]);
    expect(data.events.every((e) => e.type === "closure")).toBe(true);
  });

  it("parses delay programs", () => {
    const data = parseFaaXml(FAA_DELAYS_XML);
    expect(data.events).toMatchObject([
      { airport: "SFO", type: "ground_delay", minutes: 72 },
      { airport: "EWR", type: "ground_stop" },
      { airport: "JFK", type: "airport_delay", minutes: 30 },
    ]);
  });

  it("recognises GA-only closures and NOTAM windows", () => {
    expect(isGaOnlyClosure("LAX AD AP CLSD TO NON SKED TRANSIENT GA ACFT EXC 24HR PPR")).toBe(true);
    expect(isGaOnlyClosure("ASE AD AP CLSD EXC LIFE FLT HEL AND SAR HEL 30MIN PPR")).toBe(false);
    expect(parseNotamWindow("X 2611110600-2611111100")).toEqual([Date.UTC(2026, 10, 11, 6), Date.UTC(2026, 10, 11, 11)]);
  });
});

describe("extractSignals", () => {
  it("turns FAA programs into severe near-term signals", () => {
    const signals = extractSignals(baseInput({
      airports: [ap("SFO"), ap("EWR"), ap("JFK")],
      faa: { data: parseFaaXml(FAA_DELAYS_XML), fetchedAt: "t" },
    }));
    const by = (iata: string) => signals.find((s) => s.airport === iata)!;
    expect(by("EWR")).toMatchObject({ kind: "ground_stop", severity: 3, timing: "current" });
    expect(by("SFO")).toMatchObject({ kind: "ground_delay", severity: 3 });
    expect(by("JFK")).toMatchObject({ kind: "airport_delay", severity: 1 });
    expect(signals.map((s) => s.id)).toEqual(["S1", "S2", "S3"]);
  });

  it("downgrades current FAA programs to context for trips days away", () => {
    const signals = extractSignals(baseInput({
      daysAhead: 4,
      airports: [ap("EWR")],
      faa: { data: parseFaaXml(FAA_DELAYS_XML), fetchedAt: "t" },
    }));
    expect(signals[0]).toMatchObject({ kind: "ground_stop", severity: 0 });
    expect(signals[0].summary).toMatch(/not your travel date/);
  });

  it("ignores GA-only closures and closures outside the travel date", () => {
    const data = parseFaaXml(REAL_FAA_XML);
    const sameDay = extractSignals(baseInput({ airports: [ap("LAX"), ap("PNS")], faa: { data, fetchedAt: "t" } }));
    expect(sameDay.filter((s) => s.kind === "closure").map((s) => s.airport)).toEqual(["PNS"]);
    expect(sameDay.find((s) => s.airport === "PNS")!.severity).toBe(1); // 5h overnight closure

    const later = extractSignals(baseInput({ date: "2026-11-25", airports: [ap("PNS")], faa: { data, fetchedAt: "t" } }));
    expect(later.filter((s) => s.kind === "closure")).toHaveLength(0);
  });

  it("flags TAF thunderstorms and low ceilings in the travel window", () => {
    const [d0] = localDayWindow("2026-11-11", -8 * 3600);
    const taf: Taf = {
      icaoId: "KSFO", rawTAF: "TAF KSFO ... TSRA OVC008", issueTime: "", validTimeFrom: 0, validTimeTo: 0,
      fcsts: [
        { timeFrom: d0 / 1000 + 3600 * 14, timeTo: d0 / 1000 + 3600 * 18, fcstChange: "FM", probability: null, wspd: 12, wgst: 28, visib: 2, wxString: "TSRA", vertVis: null, clouds: [{ cover: "OVC", base: 800 }] },
      ],
    };
    const signals = extractSignals(baseInput({
      airports: [ap("SFO")],
      tafs: { url: "u", data: new Map([["SFO", taf]]), fetchedAt: "t" },
      openMeteo: new Map([["SFO", { utcOffsetSeconds: -8 * 3600 } as OpenMeteoDay]]),
    }));
    const kinds = Object.fromEntries(signals.map((s) => [s.kind, s.severity]));
    expect(kinds).toMatchObject({ thunderstorm: 2, low_visibility: 2, high_wind: 1 });
  });

  it("reads NWS forecasts and filters irrelevant alerts", () => {
    const nws: NwsAirportData = {
      airport: "ORD", timeZone: "America/Chicago", forecastUrl: "f", alertsUrl: "a", fetchedAt: "t",
      periods: [
        { name: "Wednesday", startTime: "2026-11-11T06:00:00-06:00", endTime: "", isDaytime: true, shortForecast: "Heavy Snow", detailedForecast: "Heavy snow. Gusts as high as 40 mph.", windSpeed: "15 to 25 mph" },
        { name: "Thursday", startTime: "2026-11-12T06:00:00-06:00", endTime: "", isDaytime: true, shortForecast: "Sunny", detailedForecast: "Sunny.", windSpeed: "5 mph" },
      ],
      alerts: [
        { id: "1", event: "Winter Storm Warning", headline: "Winter Storm Warning", severity: "Moderate", certainty: "", urgency: "", onset: "2026-11-11T00:00:00-06:00", effective: null, ends: "2026-11-12T00:00:00-06:00", expires: null, description: "Heavy snow expected.", areaDesc: "" },
        { id: "2", event: "Small Craft Advisory", headline: null, severity: "Minor", certainty: "", urgency: "", onset: null, effective: null, ends: null, expires: null, description: "", areaDesc: "" },
      ],
    };
    const signals = extractSignals(baseInput({
      airports: [ap("ORD")],
      nws: new Map([["ORD", nws]]),
      openMeteo: new Map([["ORD", { utcOffsetSeconds: -6 * 3600 } as OpenMeteoDay]]),
    }));
    const kinds = signals.map((s) => `${s.kind}:${s.severity}`);
    expect(kinds).toContain("snow_ice:3");
    expect(kinds).toContain("nws_alert:2");
    expect(kinds).toContain("high_wind:1");
    expect(signals.some((s) => s.evidence.excerpt.includes("Small Craft"))).toBe(false);
  });

  it("adds positive evidence when nothing adverse is found", () => {
    const om: OpenMeteoDay = { airport: "PHX", date: "2026-11-11", timezone: "America/Phoenix", utcOffsetSeconds: -7 * 3600, weatherCode: 0, precipitationMm: 0, snowfallCm: 0, precipProbabilityPct: 0, windGustKt: 12, windSpeedKt: 6, url: "u", fetchedAt: "t" };
    const signals = extractSignals(baseInput({ airports: [ap("PHX")], openMeteo: new Map([["PHX", om]]) }));
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ kind: "fair_weather", severity: 0 });
  });
});
