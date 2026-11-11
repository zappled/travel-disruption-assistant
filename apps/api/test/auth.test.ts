import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

function agent() {
  return request.agent(createApp());
}

describe("auth", () => {
  it("signs up, reads /me, logs out", async () => {
    const a = agent();
    const signup = await a.post("/auth/signup").send({ email: " Alice@Example.com ", password: "password123" });
    expect(signup.status).toBe(201);
    expect(signup.body.user.email).toBe("alice@example.com");
    expect(signup.headers["set-cookie"][0]).toMatch(/HttpOnly/i);

    const me = await a.get("/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("alice@example.com");

    expect((await a.post("/auth/logout")).status).toBe(204);
    expect((await a.get("/auth/me")).status).toBe(401);
  });

  it("logs in with correct password and rejects a wrong one", async () => {
    const app = createApp();
    await request(app).post("/auth/signup").send({ email: "bob@example.com", password: "password123" });

    const bad = await request(app).post("/auth/login").send({ email: "bob@example.com", password: "wrongpass1" });
    expect(bad.status).toBe(401);
    expect(bad.body.message).toBe("Invalid email or password.");

    const unknown = await request(app).post("/auth/login").send({ email: "nobody@example.com", password: "password123" });
    expect(unknown.status).toBe(401);
    expect(unknown.body.message).toBe(bad.body.message);

    const good = await request(app).post("/auth/login").send({ email: "BOB@example.com", password: "password123" });
    expect(good.status).toBe(200);
  });

  it("rejects duplicate emails and weak passwords", async () => {
    const app = createApp();
    await request(app).post("/auth/signup").send({ email: "c@example.com", password: "password123" });
    const dup = await request(app).post("/auth/signup").send({ email: "c@example.com", password: "password123" });
    expect(dup.status).toBe(409);
    const weak = await request(app).post("/auth/signup").send({ email: "d@example.com", password: "short" });
    expect(weak.status).toBe(400);
  });

  it("rate limits repeated failed logins", async () => {
    const app = createApp();
    await request(app).post("/auth/signup").send({ email: "e@example.com", password: "password123" });
    for (let i = 0; i < 10; i++) {
      await request(app).post("/auth/login").send({ email: "e@example.com", password: "wrongpass1" });
    }
    const locked = await request(app).post("/auth/login").send({ email: "e@example.com", password: "password123" });
    expect(locked.status).toBe(429);
  });

  it("protects /assess", async () => {
    const res = await request(createApp()).post("/assess").send({});
    expect(res.status).toBe(401);
  });
});

describe("saved routes", () => {
  const route = (n: number) => ({ label: `Trip ${n}`, origin: "JFK", destination: "SFO", prompt: "NYC to SF evening" });

  it("enforces the 5-route limit and supports update/delete", async () => {
    const a = agent();
    await a.post("/auth/signup").send({ email: "f@example.com", password: "password123" });
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const r = await a.post("/routes").send(route(i));
      expect(r.status).toBe(201);
      ids.push(r.body.route.id);
    }
    const sixth = await a.post("/routes").send(route(6));
    expect(sixth.status).toBe(409);

    const upd = await a.put(`/routes/${ids[0]}`).send({ ...route(1), label: "Renamed" });
    expect(upd.body.route.label).toBe("Renamed");

    expect((await a.delete(`/routes/${ids[1]}`)).status).toBe(204);
    const list = await a.get("/routes");
    expect(list.body.routes).toHaveLength(4);
    expect((await a.post("/routes").send(route(7))).status).toBe(201);
  });

  it("isolates routes between users", async () => {
    const app = createApp();
    const u1 = request.agent(app);
    const u2 = request.agent(app);
    await u1.post("/auth/signup").send({ email: "g@example.com", password: "password123" });
    await u2.post("/auth/signup").send({ email: "h@example.com", password: "password123" });
    const created = await u1.post("/routes").send(route(1));

    expect((await u2.get("/routes")).body.routes).toHaveLength(0);
    expect((await u2.delete(`/routes/${created.body.route.id}`)).status).toBe(404);
    expect((await u1.get("/routes")).body.routes).toHaveLength(1);
  });
});
