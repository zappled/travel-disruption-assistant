import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";

let client: Anthropic | null | undefined;

/** Returns null when no credentials are configured, so callers can fall back to rules. */
export function getClient(): Anthropic | null {
  if (client !== undefined) return client;
  const hasCreds = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  client = hasCreds ? new Anthropic({ timeout: 60_000, maxRetries: 2 }) : null;
  return client;
}

/** Thrown when the model declines; callers treat it like any other AI failure. */
export class RefusalError extends Error {}
