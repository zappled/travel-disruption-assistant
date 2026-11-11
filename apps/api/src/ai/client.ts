/**
 * AI provider selection. Claude is the primary provider; Gemini (free tier via
 * Google AI Studio) is a fallback used only when no Claude credentials exist.
 * Both return the same Zod-validated structured output, so everything
 * downstream (evidence checks, confidence cap, rules fallback) is unchanged.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { defaultCredentials } from "@anthropic-ai/sdk/lib/credentials/credential-chain";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";

/** Which credentials are in use, shown on /health and in the startup log. */
export type AiAuth = "api_key" | "auth_token" | "cli_login" | "gemini_key" | "none";

export interface StructuredRequest<S extends z.ZodType> {
  system: string;
  user: string;
  schema: S;
  effort: "low" | "medium";
  maxTokens: number;
}

export interface AiProvider {
  id: "claude" | "gemini";
  label: string; // e.g. "Claude (claude-opus-5-5)"
  generate<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>>;
}

/** Thrown when the model declines; callers treat it like any other AI failure. */
export class RefusalError extends Error {}

// ---------------------------------------------------------------- Claude

function claudeProvider(client: Anthropic): AiProvider {
  return {
    id: "claude",
    label: `Claude (${CLAUDE_MODEL})`,
    async generate(req) {
      const response = await client.beta.messages.parse({
        model: CLAUDE_MODEL,
        max_tokens: req.maxTokens,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: req.effort, format: zodOutputFormat(req.schema) },
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      });
      if (response.stop_reason === "refusal") throw new RefusalError("Claude declined this request");
      if (!response.parsed_output) throw new Error(`No structured output from Claude (stop_reason: ${response.stop_reason})`);
      return response.parsed_output as z.infer<typeof req.schema>;
    },
  };
}

// ---------------------------------------------------------------- Gemini

/** Zod → JSON Schema for Gemini's responseJsonSchema (which rejects `$schema`). */
function toGeminiSchema(schema: z.ZodType): unknown {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema) as Record<string, unknown>;
  return json;
}

function geminiProvider(apiKey: string): AiProvider {
  const ai = new GoogleGenAI({ apiKey });
  return {
    id: "gemini",
    label: `Gemini (${GEMINI_MODEL})`,
    async generate(req) {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: req.user,
        config: {
          systemInstruction: req.system,
          responseMimeType: "application/json",
          responseJsonSchema: toGeminiSchema(req.schema),
          maxOutputTokens: req.maxTokens,
          abortSignal: AbortSignal.timeout(60_000),
        },
      });
      const text = response.text;
      if (!text) throw new Error(`No output from Gemini (finish reason: ${response.candidates?.[0]?.finishReason ?? "unknown"})`);
      // Validate exactly as the Claude path does; malformed output → rules fallback.
      return req.schema.parse(JSON.parse(text)) as z.infer<typeof req.schema>;
    },
  };
}

// ---------------------------------------------------------------- selection

interface ProviderState {
  provider: AiProvider | null;
  auth: AiAuth;
  detail?: string;
}

let state: Promise<ProviderState> | null = null;

async function resolveClaude(): Promise<ProviderState | null> {
  // An empty ANTHROPIC_API_KEY= (e.g. copied from .env.example) would still take
  // precedence and authenticate with an empty key, hiding a CLI login. Drop it.
  for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) {
    if (process.env[name] !== undefined && process.env[name]!.trim() === "") delete process.env[name];
  }
  const opts = { timeout: 60_000, maxRetries: 2 };
  if (process.env.ANTHROPIC_API_KEY) return { provider: claudeProvider(new Anthropic(opts)), auth: "api_key" };
  if (process.env.ANTHROPIC_AUTH_TOKEN) return { provider: claudeProvider(new Anthropic(opts)), auth: "auth_token" };
  try {
    // `ant auth login` profile (~/.config/anthropic), which the SDK uses automatically.
    const found = await defaultCredentials({
      baseURL: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
      fetch: globalThis.fetch,
    });
    if (found) return { provider: claudeProvider(new Anthropic(opts)), auth: "cli_login" };
  } catch (err) {
    console.warn(`[api] couldn't read the ant CLI profile: ${err instanceof Error ? err.message : err}`);
  }
  return null;
}

async function resolve(): Promise<ProviderState> {
  const claude = await resolveClaude();
  if (claude) return claude;
  const geminiKey = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "").trim();
  if (geminiKey) return { provider: geminiProvider(geminiKey), auth: "gemini_key" };
  return { provider: null, auth: "none", detail: "no Claude credentials (API key or `ant auth login`) and no GEMINI_API_KEY" };
}

/** Resolves once per process. A null provider means callers use the rules fallback. */
export function getProviderState(): Promise<ProviderState> {
  state ??= resolve().then((s) => {
    const how = {
      api_key: "Claude via ANTHROPIC_API_KEY",
      auth_token: "Claude via ANTHROPIC_AUTH_TOKEN",
      cli_login: "Claude via ant CLI login",
      gemini_key: "Gemini via GEMINI_API_KEY (fallback)",
      none: "none, rules-only assessments",
    }[s.auth];
    console.log(`[api] AI provider: ${how}${s.provider ? `, model ${s.provider.label}` : ""}${s.detail ? ` (${s.detail})` : ""}`);
    return s;
  });
  return state;
}

export async function getProvider(): Promise<AiProvider> {
  const { provider } = await getProviderState();
  if (!provider) throw new Error("AI is not configured (set ANTHROPIC_API_KEY, run `ant auth login`, or set GEMINI_API_KEY)");
  return provider;
}

/** For tests: forget the resolved provider. */
export function resetProviderForTests() {
  state = null;
}
