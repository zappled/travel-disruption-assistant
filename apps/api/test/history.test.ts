import { describe, expect, it } from "vitest";
import { recordHistory } from "../src/history.js";
import { createUser } from "../src/auth.js";
import { createApp } from "../src/app.js";
import { MemoryStore } from "../src/store.js";
import type { AssessResponse } from "../src/types.js";
import { MAX_HISTORY } from "../src/types.js";
import { PASSWORD, loggedInAgent } from "./helpers.js";

function fakeResult(n: number): AssessResponse {
  return {
    route: { origin: [{ iata: "JFK" }], destination: [{ iata: "SFO" }], date: "2026-11-12", daysAhead: 1 } as AssessResponse["route"],
    assessment: { overallRisk: "low", confidence: "high", confidenceReason: "", headline: `Result ${n}`, summary: "", risks: [], recommendations: [], generatedBy: "rules" },
    signals: [],
    sources: [],
    notices: [],
    generatedAt: new Date(2026, 10, 11, 0, n).toISOString(),
  };
}
const req = { origin: "JFK", destination: "SFO", date: "2026-11-12", timeOfDay: null, notes: null };

async function setup() {
  const store = new MemoryStore();
  const u1 = await createUser(store, "a@example.com", PASSWORD);
  const u2 = await createUser(store, "b@example.com", PASSWORD);
  const app = createApp(store);
  return { store, app, u1, u2 };
}

describe("history", () => {
  it("lists newest first, caps at MAX_HISTORY, and returns full entries", async () => {
    const { store, app, u1 } = await setup();
    for (let i = 1; i <= MAX_HISTORY + 3; i++) recordHistory(store, u1.id, req, fakeResult(i));
    const a = await loggedInAgent(app, "a@example.com");

    const list = await a.get("/history");
    expect(list.body.entries).toHaveLength(MAX_HISTORY);
    expect(list.body.entries[0]).toMatchObject({ headline: `Result ${MAX_HISTORY + 3}`, overallRisk: "low", originCodes: ["JFK"] });
    expect(list.body.entries[0].result).toBeUndefined();

    const full = await a.get(`/history/${list.body.entries[0].id}`);
    expect(full.body.entry.result.assessment.headline).toBe(`Result ${MAX_HISTORY + 3}`);
    expect(full.body.entry.request).toEqual(req);
  });

  it("deletes entries and isolates users", async () => {
    const { store, app, u1 } = await setup();
    const entry = recordHistory(store, u1.id, req, fakeResult(1));
    const b = await loggedInAgent(app, "b@example.com");
    expect((await b.get("/history")).body.entries).toHaveLength(0);
    expect((await b.get(`/history/${entry.id}`)).status).toBe(404);
    expect((await b.delete(`/history/${entry.id}`)).status).toBe(404);

    const a = await loggedInAgent(app, "a@example.com");
    expect((await a.delete(`/history/${entry.id}`)).status).toBe(204);
    expect((await a.get("/history")).body.entries).toHaveLength(0);
  });
});
