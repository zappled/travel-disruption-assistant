import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { confidenceCap, enforceEvidence, localToday } from "../src/assessment.js";
import { rulesAssessment } from "../src/rules.js";
import type { Signal, SourceStatus } from "../src/types.js";

const sig = (id: string, over: Partial<Signal> = {}): Signal => ({
  id,
  airport: "SFO",
  kind: "thunderstorm",
  severity: 2,
  summary: "Thunderstorms forecast at SFO",
  timing: "forecast",
  evidence: { source: "nws", sourceName: "NWS", url: "u", observedAt: "t", excerpt: "x" },
  ...over,
});

const src = (status: SourceStatus["status"]): SourceStatus => ({ source: "nws", name: "n", url: "u", status, fetchedAt: "t" });

describe("enforceEvidence", () => {
  it("drops risks that cite no real signal and strips unknown IDs", () => {
    const out = enforceEvidence(
      {
        overallRisk: "high", confidence: "high", confidenceReason: "", headline: "", summary: "",
        recommendations: [],
        risks: [
          { title: "Storms", airports: ["SFO"], likelihood: "likely", impact: "major", explanation: "", evidenceIds: ["S1", "S99"] },
          { title: "Invented strike", airports: ["SFO"], likelihood: "possible", impact: "major", explanation: "", evidenceIds: ["S42"] },
          { title: "No citation", airports: ["SFO"], likelihood: "possible", impact: "minor", explanation: "", evidenceIds: [] },
        ],
      },
      [sig("S1")],
    );
    expect(out.risks).toHaveLength(1);
    expect(out.risks[0].evidenceIds).toEqual(["S1"]);
    expect(out.droppedRisks).toBe(2);
  });
});

describe("confidenceCap", () => {
  it("caps by horizon and source failures", () => {
    expect(confidenceCap(0, [src("ok")]).cap).toBe("high");
    expect(confidenceCap(3, [src("ok")]).cap).toBe("medium");
    expect(confidenceCap(6, [src("ok")]).cap).toBe("low");
    expect(confidenceCap(0, [src("partial")]).cap).toBe("medium");
    expect(confidenceCap(0, [src("error"), src("error")]).cap).toBe("low");
  });
});

describe("rulesAssessment", () => {
  it("says low risk with fair weather only", () => {
    const a = rulesAssessment([sig("S1", { kind: "fair_weather", severity: 0 })], 1);
    expect(a.overallRisk).toBe("low");
    expect(a.risks).toHaveLength(0);
    expect(a.generatedBy).toBe("rules");
  });

  it("escalates on severe signals and cites them", () => {
    const a = rulesAssessment([sig("S1", { kind: "ground_stop", severity: 3 }), sig("S2")], 0);
    expect(a.overallRisk).toBe("severe");
    expect(a.risks.flatMap((r) => r.evidenceIds).sort()).toEqual(["S1", "S2"]);
    expect(a.recommendations.some((r) => r.priority === "now")).toBe(true);
  });
});

describe("localToday", () => {
  it("uses the airport's approximate local date", () => {
    // 03:00 UTC on Nov 12 is still Nov 11 in San Francisco.
    expect(localToday(-122.4, new Date("2026-11-12T03:00:00Z"))).toBe("2026-11-11");
    expect(localToday(-73.8, new Date("2026-11-12T06:00:00Z"))).toBe("2026-11-12");
  });
});

describe("POST /assess validation", () => {
  async function loggedIn() {
    const a = request.agent(createApp());
    await a.post("/auth/signup").send({ email: "v@example.com", password: "password123" });
    return a;
  }
  const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);

  it("asks the user to choose for ambiguous cities", async () => {
    const res = await (await loggedIn()).post("/assess").send({ origin: "Portland", destination: "SFO", date: tomorrow });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("ambiguous_location");
    expect(res.body.choices[0].candidates.map((c: { iata: string }) => c.iata)).toEqual(expect.arrayContaining(["PDX", "PWM"]));
  });

  it("rejects unknown places, same route, past and far-future dates", async () => {
    const a = await loggedIn();
    expect((await a.post("/assess").send({ origin: "London Heathrow", destination: "SFO", date: tomorrow })).body.error).toBe("unknown_location");
    expect((await a.post("/assess").send({ origin: "SFO", destination: "San Francisco (SFO)", date: tomorrow })).body.error).toBe("same_route");
    expect((await a.post("/assess").send({ origin: "JFK", destination: "SFO", date: "2020-01-01" })).body.error).toBe("past_date");
    const far = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    expect((await a.post("/assess").send({ origin: "JFK", destination: "SFO", date: far })).body.error).toBe("too_far_ahead");
  });
});
