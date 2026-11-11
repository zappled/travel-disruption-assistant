import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { seedDemoUser } from "../src/auth.js";
import { MemoryStore } from "../src/store.js";
import { PASSWORD, appWithUsers, loggedInAgent } from "./helpers.js";

describe("auth", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("logs in, reads /me, logs out", async () => {
    const app = await appWithUsers("alice@example.com");
    const a = request.agent(app);
    const login = await a.post("/auth/login").send({ email: " Alice@Example.com ", password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe("alice@example.com");
    expect(login.headers["set-cookie"][0]).toMatch(/HttpOnly/i);

    const me = await a.get("/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("alice@example.com");

    expect((await a.post("/auth/logout")).status).toBe(204);
    expect((await a.get("/auth/me")).status).toBe(401);
  });

  it("rejects wrong passwords and unknown users with the same message", async () => {
    const app = await appWithUsers("bob@example.com");
    const bad = await request(app).post("/auth/login").send({ email: "bob@example.com", password: "wrongpass1" });
    expect(bad.status).toBe(401);
    expect(bad.body.message).toBe("Invalid email or password.");
    const unknown = await request(app).post("/auth/login").send({ email: "nobody@example.com", password: PASSWORD });
    expect(unknown.status).toBe(401);
    expect(unknown.body.message).toBe(bad.body.message);
  });

  it("has no signup endpoint", async () => {
    const res = await request(createApp()).post("/auth/signup").send({ email: "x@example.com", password: PASSWORD });
    expect(res.status).toBe(404);
  });

  it("seeds the demo user from env", async () => {
    vi.stubEnv("DEMO_EMAIL", "Demo@Example.com");
    vi.stubEnv("DEMO_PASSWORD", "demo-pass-123");
    const store = new MemoryStore();
    await seedDemoUser(store);
    const res = await request(createApp(store)).post("/auth/login").send({ email: "demo@example.com", password: "demo-pass-123" });
    expect(res.status).toBe(200);
  });

  it("skips seeding when the demo env is missing or invalid", async () => {
    vi.stubEnv("DEMO_EMAIL", "demo@example.com");
    vi.stubEnv("DEMO_PASSWORD", "short");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new MemoryStore();
    await seedDemoUser(store);
    expect(warn).toHaveBeenCalled();
    const res = await request(createApp(store)).post("/auth/login").send({ email: "demo@example.com", password: "short" });
    expect(res.status).toBe(401);
  });

  it("rate limits repeated failed logins", async () => {
    const app = await appWithUsers("e@example.com");
    for (let i = 0; i < 10; i++) {
      await request(app).post("/auth/login").send({ email: "e@example.com", password: "wrongpass1" });
    }
    const locked = await request(app).post("/auth/login").send({ email: "e@example.com", password: PASSWORD });
    expect(locked.status).toBe(429);
  });

  it("protects /assess, /parse and /routes", async () => {
    const app = createApp();
    expect((await request(app).post("/assess").send({})).status).toBe(401);
    expect((await request(app).post("/parse").send({})).status).toBe(401);
    expect((await request(app).get("/routes")).status).toBe(401);
  });
});

describe("saved routes", () => {
  const DESTS = ["SFO", "LAX", "ORD", "DEN", "SEA", "BOS", "MIA"];
  const route = (n: number) => ({ origin: "JFK", destination: DESTS[n - 1], prompt: `Trip ${n}` });

  it("enforces the 5-route limit and supports update/delete", async () => {
    const a = await loggedInAgent(await appWithUsers("f@example.com"), "f@example.com");
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const r = await a.post("/routes").send(route(i));
      expect(r.status).toBe(201);
      ids.push(r.body.route.id);
    }
    expect((await a.post("/routes").send(route(6))).status).toBe(409);

    const upd = await a.put(`/routes/${ids[0]}`).send({ ...route(1), prompt: "Monday 7am flight" });
    expect(upd.body.route.prompt).toBe("Monday 7am flight");
    expect(upd.body.route.label).toBeUndefined();

    expect((await a.delete(`/routes/${ids[1]}`)).status).toBe(204);
    expect((await a.get("/routes")).body.routes).toHaveLength(4);
    expect((await a.post("/routes").send(route(7))).status).toBe(201);
  });

  it("rejects saving the same path twice and allows an empty description", async () => {
    const a = await loggedInAgent(await appWithUsers("dup@example.com"), "dup@example.com");
    const first = await a.post("/routes").send({ origin: "JFK", destination: "SFO" });
    expect(first.status).toBe(201);
    expect(first.body.route.prompt).toBeNull();
    const again = await a.post("/routes").send({ origin: "jfk", destination: "sfo", prompt: "different text" });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("duplicate");
    const other = await a.post("/routes").send({ origin: "JFK", destination: "LAX" });
    const clash = await a.put(`/routes/${other.body.route.id}`).send({ origin: "JFK", destination: "SFO" });
    expect(clash.status).toBe(409);
  });

  it("stores the usual time of day and treats different times as different routes", async () => {
    const a = await loggedInAgent(await appWithUsers("tod@example.com"), "tod@example.com");
    const morning = await a.post("/routes").send({ origin: "JFK", destination: "SFO", timeOfDay: "morning" });
    expect(morning.status).toBe(201);
    expect(morning.body.route.timeOfDay).toBe("morning");
    expect((await a.post("/routes").send({ origin: "JFK", destination: "SFO", timeOfDay: "evening" })).status).toBe(201);
    expect((await a.post("/routes").send({ origin: "JFK", destination: "SFO", timeOfDay: "morning" })).status).toBe(409);
    const anyTime = await a.post("/routes").send({ origin: "JFK", destination: "SFO" });
    expect(anyTime.body.route.timeOfDay).toBeNull();
    expect((await a.post("/routes").send({ origin: "JFK", destination: "SFO", timeOfDay: "lunchtime" })).status).toBe(400);
  });

  it("isolates routes between users", async () => {
    const app = await appWithUsers("g@example.com", "h@example.com");
    const u1 = await loggedInAgent(app, "g@example.com");
    const u2 = await loggedInAgent(app, "h@example.com");
    const created = await u1.post("/routes").send(route(1));

    expect((await u2.get("/routes")).body.routes).toHaveLength(0);
    expect((await u2.delete(`/routes/${created.body.route.id}`)).status).toBe(404);
    expect((await u1.get("/routes")).body.routes).toHaveLength(1);
  });
});
