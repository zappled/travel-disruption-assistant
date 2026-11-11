import { describe, expect, it } from "vitest";
import { resolveAirports } from "../src/airports.js";

const codes = (input: string) => {
  const r = resolveAirports(input);
  return r.kind === "resolved" ? r.airports.map((a) => a.iata) : r.kind;
};

describe("resolveAirports", () => {
  it("resolves IATA and ICAO codes", () => {
    expect(codes("sfo")).toEqual(["SFO"]);
    expect(codes("KORD")).toEqual(["ORD"]);
    expect(codes("San Francisco (SFO)")).toEqual(["SFO"]);
  });

  it("expands multi-airport metros", () => {
    expect(codes("New York")).toEqual(["JFK", "LGA", "EWR"]);
    expect(codes("chicago")).toEqual(["ORD", "MDW"]);
  });

  it("flags ambiguous city names instead of guessing", () => {
    const r = resolveAirports("Portland");
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") {
      expect(r.candidates.map((a) => a.iata).sort()).toEqual(expect.arrayContaining(["PDX", "PWM"]));
    }
    expect(codes("Portland, ME")).toEqual(["PWM"]);
  });

  it("handles Hawaii, Alaska, and territories", () => {
    expect(codes("Honolulu")).toEqual(["HNL"]);
    expect(codes("Anchorage")).toEqual(["ANC"]);
    expect(codes("SJU")).toEqual(["SJU"]);
  });

  it("returns not_found for non-US or nonsense input", () => {
    expect(codes("LHR")).toBe("not_found");
    expect(codes("Atlantis")).toBe("not_found");
  });
});
