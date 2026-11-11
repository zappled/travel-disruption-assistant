import { describe, expect, it } from "vitest";
import { holdResult, recordHistory } from "../src/history.js";
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

  it("saves a held result only when asked, idempotently, and per user", async () => {
    const { store, app, u1 } = await setup();
    const resultId = holdResult(store, u1.id, req, fakeResult(7));
    const a = await loggedInAgent(app, "a@example.com");
    expect((await a.get("/history")).body.entries).toHaveLength(0); // not saved yet

    const first = await a.post("/history").send({ resultId });
    expect(first.status).toBe(201);
    expect(first.body.entry).toMatchObject({ id: resultId, headline: "Result 7" });
    const again = await a.post("/history").send({ resultId });
    expect(again.status).toBe(200);
    expect((await a.get("/history")).body.entries).toHaveLength(1);

    const b = await loggedInAgent(app, "b@example.com");
    expect((await b.post("/history").send({ resultId })).status).toBe(404);
    expect((await a.post("/history").send({ resultId: "00000000-0000-4000-8000-000000000000" })).body.error).toBe("expired");
    expect((await a.post("/history").send({})).status).toBe(400);
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
