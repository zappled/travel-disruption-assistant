import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { Store } from "./store.js";
import type { User } from "./types.js";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export const SESSION_COOKIE = "tda_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

interface StoredUser extends User {
  passwordHash: string; // hex
  salt: string; // hex
  createdAt: string;
}

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

const userKey = (email: string) => `user:${email}`;
const sessionKey = (token: string) => `session:${token}`;

async function hashPassword(password: string, salt: Buffer) {
  return scryptAsync(password, salt, 64);
}

export async function createUser(store: Store, email: string, password: string): Promise<User> {
  const salt = randomBytes(16);
  const hash = await hashPassword(password, salt);
  const user: StoredUser = {
    id: randomUUID(),
    email,
    passwordHash: hash.toString("hex"),
    salt: salt.toString("hex"),
    createdAt: new Date().toISOString(),
  };
  store.set(userKey(email), user);
  return { id: user.id, email: user.email };
}

async function verifyUser(store: Store, email: string, password: string): Promise<User | null> {
  const user = store.get<StoredUser>(userKey(email));
  // Hash even when the user doesn't exist so timing doesn't reveal which emails are registered.
  const salt = user ? Buffer.from(user.salt, "hex") : randomBytes(16);
  const hash = await hashPassword(password, salt);
  if (!user) return null;
  const expected = Buffer.from(user.passwordHash, "hex");
  return timingSafeEqual(hash, expected) ? { id: user.id, email: user.email } : null;
}

function startSession(store: Store, res: Response, user: User) {
  const token = randomBytes(32).toString("base64url");
  store.set(sessionKey(token), user, SESSION_TTL_MS);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

/** Simple fixed-window limiter on failed logins, keyed by email + IP. */
function tooManyAttempts(store: Store, key: string): boolean {
  return (store.get<number>(`login-attempts:${key}`) ?? 0) >= LOGIN_MAX_ATTEMPTS;
}
function recordFailedAttempt(store: Store, key: string) {
  const k = `login-attempts:${key}`;
  store.set(k, (store.get<number>(k) ?? 0) + 1, LOGIN_WINDOW_MS);
}

declare module "express-serve-static-core" {
  interface Request {
    user?: User;
  }
}

export function requireAuth(store: Store) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    const user = token ? store.get<User>(sessionKey(token)) : undefined;
    if (!user) {
      res.status(401).json({ error: "unauthenticated", message: "Please log in." });
      return;
    }
    req.user = user;
    next();
  };
}

export function authRouter(store: Store) {
  const router = Router();

  // No self-service signup: accounts are provisioned (for the prototype, the
  // demo user from .env). Real deployment would use the company's SSO.
  router.post("/login", async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    const invalid = { error: "invalid_credentials", message: "Invalid email or password." };
    if (!parsed.success) {
      res.status(401).json(invalid);
      return;
    }
    const { email, password } = parsed.data;
    const limiterKey = `${email}|${req.ip}`;
    if (tooManyAttempts(store, limiterKey)) {
      res.status(429).json({ error: "too_many_attempts", message: "Too many failed attempts. Try again in 15 minutes." });
      return;
    }
    const user = await verifyUser(store, email, password);
    if (!user) {
      recordFailedAttempt(store, limiterKey);
      res.status(401).json(invalid);
      return;
    }
    startSession(store, res, user);
    res.json({ user });
  });

  router.post("/logout", (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (token) store.delete(sessionKey(token));
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.status(204).end();
  });

  router.get("/me", requireAuth(store), (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}

/** Create the demo account from env on startup (the store is in-memory). */
export async function seedDemoUser(store: Store) {
  const parsed = credentialsSchema.safeParse({ email: process.env.DEMO_EMAIL ?? "", password: process.env.DEMO_PASSWORD ?? "" });
  if (!parsed.success) {
    console.warn(
      `[api] no valid demo user — set DEMO_EMAIL and DEMO_PASSWORD (min 8 chars) in apps/api/.env to be able to log in (${parsed.error.issues[0].message})`,
    );
    return;
  }
  const { email, password } = parsed.data;
  if (!store.get(userKey(email))) {
    await createUser(store, email, password);
    console.log(`[api] demo user ready: ${email}`);
  }
}
