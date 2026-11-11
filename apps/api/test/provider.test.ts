import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AssessmentSchema } from "../src/ai/assess.js";
import { getProviderState, isRetryableGeminiError, resetProviderForTests } from "../src/ai/client.js";
import { ParsedTripSchema } from "../src/ai/parse.js";

// Point the Anthropic CLI lookup at an empty dir so a real login on this
// machine can't affect the tests.
function noClaude() {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
  vi.stubEnv("ANTHROPIC_CONFIG_DIR", "/nonexistent-tda-test");
}

describe("AI provider selection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetProviderForTests();
  });

  it("prefers Claude when an Anthropic key is set, even with a Gemini key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("GEMINI_API_KEY", "gem-test");
    const s = await getProviderState();
    expect(s.auth).toBe("api_key");
    expect(s.provider?.id).toBe("claude");
  });

  it("falls back to Gemini when there are no Claude credentials", async () => {
    noClaude();
    vi.stubEnv("GEMINI_API_KEY", "gem-test");
    const s = await getProviderState();
    expect(s.auth).toBe("gemini_key");
    expect(s.provider?.id).toBe("gemini");
    expect(s.provider?.label).toMatch(/^Gemini \(/);
  });

  it("uses rules only when nothing is configured", async () => {
    noClaude();
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
    const s = await getProviderState();
    expect(s.auth).toBe("none");
    expect(s.provider).toBeNull();
  });
});

describe("Gemini fallback decision", () => {
  it("retries on busy, rate-limited, server errors, retired models and timeouts only", () => {
    expect(isRetryableGeminiError({ status: 503 })).toBe(true);
    expect(isRetryableGeminiError({ status: 404 })).toBe(true); // model retired / unavailable
    expect(isRetryableGeminiError({ status: 429 })).toBe(true);
    expect(isRetryableGeminiError({ status: 500 })).toBe(true);
    expect(isRetryableGeminiError(Object.assign(new Error("t"), { name: "TimeoutError" }))).toBe(true);
    expect(isRetryableGeminiError({ status: 400 })).toBe(false); // bad request won't improve on another model
    expect(isRetryableGeminiError({ status: 403 })).toBe(false); // bad key
    expect(isRetryableGeminiError(new SyntaxError("bad JSON"))).toBe(false);
  });
});

describe("Gemini schema compatibility", () => {
  // Keywords Gemini's responseJsonSchema accepts (per @google/genai docs).
  const SUPPORTED = new Set([
    "$id", "$defs", "$ref", "$anchor", "type", "format", "title", "description", "enum", "items",
    "prefixItems", "minItems", "maxItems", "minimum", "maximum", "anyOf", "oneOf", "properties",
    "additionalProperties", "required", "propertyOrdering",
  ]);
  function unsupportedKeys(node: unknown, path = "$"): string[] {
    if (Array.isArray(node)) return node.flatMap((n, i) => unsupportedKeys(n, `${path}[${i}]`));
    if (!node || typeof node !== "object") return [];
    const out: string[] = [];
    for (const [k, v] of Object.entries(node)) {
      if (path.endsWith(".properties")) {
        out.push(...unsupportedKeys(v, `${path}.${k}`)); // property names, not keywords
        continue;
      }
      if (!SUPPORTED.has(k) && k !== "$schema" && k !== "const") out.push(`${path}.${k}`);
      out.push(...unsupportedKeys(v, `${path}.${k}`));
    }
    return out;
  }

  it("the app's parse and assessment schemas only use supported keywords", () => {
    for (const s of [ParsedTripSchema, AssessmentSchema]) expect(unsupportedKeys(z.toJSONSchema(s))).toEqual([]);
  });
});
