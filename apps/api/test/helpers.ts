import request from "supertest";
import { createApp } from "../src/app.js";
import { createUser } from "../src/auth.js";
import { MemoryStore } from "../src/store.js";

export const PASSWORD = "password123";

/** App with pre-provisioned users (there is no signup endpoint). */
export async function appWithUsers(...emails: string[]) {
  const store = new MemoryStore();
  for (const email of emails) await createUser(store, email, PASSWORD);
  return createApp(store);
}

/** A supertest agent already logged in as `email`. */
export async function loggedInAgent(app: Parameters<typeof request.agent>[0], email: string) {
  const agent = request.agent(app);
  const res = await agent.post("/auth/login").send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  return agent;
}
