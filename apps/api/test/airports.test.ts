import request from "supertest";
import { describe, expect, it } from "vitest";
import { appWithUsers, loggedInAgent } from "./helpers.js";
import { resolveAirports, searchAirports } from "../src/airports.js";

const values = (q: string) => searchAirports(q).map((s) => s.value);

describe("GET /airports/search", () => {
  it("requires login and returns suggestions", async () => {
    const app = await appWithUsers("s@example.com");
    expect((await request(app).get("/airports/search?q=sfo")).status).toBe(401);
    const a = await loggedInAgent(app, "s@example.com");
    const res = await a.get("/airports/search?q=new%20york");
    expect(res.status).toBe(200);
    expect(res.body.suggestions[0]).toMatchObject({ kind: "metro", value: "New York" });
    expect((await a.get("/airports/search")).body.suggestions).toEqual([]);
  });
});

describe("searchAirports", () => {
  it("puts an exact code first", () => {
    expect(values("sfo")[0]).toBe("SFO");
    expect(values("PDX")[0]).toBe("PDX");
  });

  it("offers the metro for multi-airport cities, then its airports", () => {
    const s = searchAirports("new y");
    expect(s[0]).toMatchObject({ kind: "metro", value: "New York", codes: ["JFK", "LGA", "EWR"] });
    expect(values("nyc")[0]).toBe("New York");
    expect(values("chicago")).toEqual(expect.arrayContaining(["Chicago", "ORD", "MDW"]));
  });

  it("lets the user pick between same-named cities", () => {
    const s = searchAirports("portland");
    expect(s.map((x) => x.value)).toEqual(expect.arrayContaining(["PDX", "PWM"]));
    expect(s.find((x) => x.value === "PWM")!.label).toBe("Portland, ME");
  });

  it("matches airport names and code prefixes", () => {
    expect(values("o'hare")).toContain("ORD");
    expect(values("laguardia")).toContain("LGA");
    expect(values("de")).toContain("DEN");
  });

  it("doesn't match mid-word in airport names", () => {
    expect(values("port")).not.toContain("ALB"); // "Albany International Airport"
    expect(values("den")).not.toContain("SRQ"); // "Sarasota Bradenton"
  });

  it("returns nothing for empty input and caps results", () => {
    expect(searchAirports("  ")).toEqual([]);
    expect(searchAirports("a").length).toBeLessThanOrEqual(8);
  });
});

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
