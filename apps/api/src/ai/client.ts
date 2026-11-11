import Anthropic from "@anthropic-ai/sdk";
import { defaultCredentials } from "@anthropic-ai/sdk/lib/credentials/credential-chain";

export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";

/** How the API authenticates to Claude, shown on /health. */
export type AiAuth = "api_key" | "auth_token" | "cli_login" | "none";

interface ClientState {
  client: Anthropic | null;
  auth: AiAuth;
  detail?: string;
}

let state: Promise<ClientState> | null = null;

async function resolve(): Promise<ClientState> {
  // An empty ANTHROPIC_API_KEY= (e.g. copied from .env.example) would still take
  // precedence and authenticate with an empty key, hiding a CLI login. Drop it.
  for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) {
    if (process.env[name] !== undefined && process.env[name]!.trim() === "") delete process.env[name];
  }
  const opts = { timeout: 60_000, maxRetries: 2 };

  if (process.env.ANTHROPIC_API_KEY) return { client: new Anthropic(opts), auth: "api_key" };
  if (process.env.ANTHROPIC_AUTH_TOKEN) return { client: new Anthropic(opts), auth: "auth_token" };

  // No key in the environment: look for an `ant auth login` profile
  // (~/.config/anthropic), which the SDK uses automatically.
  try {
    const found = await defaultCredentials({
      baseURL: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
      fetch: globalThis.fetch,
    });
    if (found) return { client: new Anthropic(opts), auth: "cli_login" };
    return { client: null, auth: "none", detail: "No ANTHROPIC_API_KEY and no `ant auth login` profile found" };
  } catch (err) {
    // e.g. ANTHROPIC_PROFILE names a profile that doesn't exist
    return { client: null, auth: "none", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Resolves once per process. Returns a null client when no credentials exist, so callers fall back to rules. */
export function getClientState(): Promise<ClientState> {
  state ??= resolve().then((s) => {
    const how = { api_key: "ANTHROPIC_API_KEY", auth_token: "ANTHROPIC_AUTH_TOKEN", cli_login: "ant CLI login", none: "none" }[s.auth];
    console.log(`[api] Claude credentials: ${how}${s.detail ? ` (${s.detail})` : ""}`);
    return s;
  });
  return state;
}

export async function getClient(): Promise<Anthropic | null> {
  return (await getClientState()).client;
}

/** Thrown when the model declines; callers treat it like any other AI failure. */
export class RefusalError extends Error {}
