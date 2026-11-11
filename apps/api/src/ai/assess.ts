import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Airport, Assessment, Signal, SourceStatus } from "../types.js";
import { MODEL, RefusalError, getClient } from "./client.js";

const AssessmentSchema = z.object({
  overallRisk: z.enum(["low", "moderate", "high", "severe"]),
  confidence: z.enum(["low", "medium", "high"]),
  confidenceReason: z.string().describe("One sentence: why this confidence level (forecast horizon, source agreement, missing data)."),
  headline: z.string().describe("Plain-language verdict, max ~12 words, e.g. 'Low risk — clear weather at both ends'."),
  summary: z.string().describe("2–3 sentences for a busy traveller."),
  risks: z.array(
    z.object({
      title: z.string(),
      airports: z.array(z.string()).describe("IATA codes affected"),
      likelihood: z.enum(["unlikely", "possible", "likely"]),
      impact: z.enum(["minor", "moderate", "major"]),
      explanation: z.string().describe("Why this matters for the trip, referencing the evidence."),
      evidenceIds: z.array(z.string()).describe("IDs of the signals (e.g. S1, S3) that support this risk. Required."),
    }),
  ),
  recommendations: z.array(
    z.object({
      action: z.string().describe("Concrete, specific action."),
      reason: z.string(),
      priority: z.enum(["now", "before_travel", "day_of_travel"]),
    }),
  ),
});

const SYSTEM = `You are a travel-disruption analyst for a company whose employees fly within the United States.
You receive a trip and a list of SIGNALS. Each signal was produced by deterministic rules from live public data (FAA airspace status, National Weather Service, aviation TAF forecasts, Open-Meteo). The signals are the only facts you may rely on.

Your job:
1. Decide the overall disruption risk for the trip and your confidence.
2. Group related signals into a small number of distinct risks (usually 0–4). Every risk MUST cite the signal IDs that support it in evidenceIds. Never state a fact that no signal supports.
3. Give practical recommendations a traveller can act on (rebooking earlier/later, choosing a different airport in a multi-airport city, checking for airline travel waivers, allowing extra time, monitoring the flight status, checking again closer to the date).

Guidance:
- Low risk is a valid, useful answer. If signals are only fair_weather or severity 0, say so plainly and keep recommendations minimal.
- Severity scale: 0 informational, 1 minor, 2 significant, 3 severe. A single severity-1 signal rarely justifies more than "low".
- Signals with timing "current" describe conditions right now. For trips 2+ days away they are context, not a forecast for the travel date.
- Where several airports serve a city (e.g. JFK/LGA/EWR), point out if one is notably worse than the others.
- When sources disagree (e.g. one model forecasts heavy rain, another does not), mention the uncertainty.
- Confidence must reflect the forecast horizon (5+ days out is inherently low confidence) and missing or failed sources.
- Write for a non-expert. Avoid aviation jargon; if you must use a term like "ground delay program", explain it briefly.`;

export interface AssessContext {
  origin: Airport[];
  destination: Airport[];
  date: string;
  daysAhead: number;
  timeOfDay?: string | null;
  notes?: string | null;
  signals: Signal[];
  sources: SourceStatus[];
}

function buildPrompt(ctx: AssessContext): string {
  const ap = (a: Airport) => `${a.iata} (${a.name}, ${a.city}, ${a.region})`;
  const signals = ctx.signals.map((s) => ({
    id: s.id,
    airport: s.airport,
    kind: s.kind,
    severity: s.severity,
    timing: s.timing,
    summary: s.summary,
    source: s.evidence.sourceName,
    excerpt: s.evidence.excerpt,
  }));
  const sources = ctx.sources.map((s) => ({ name: s.name, status: s.status, detail: s.detail ?? null }));
  return [
    `<trip>`,
    `Origin airports: ${ctx.origin.map(ap).join("; ")}`,
    `Destination airports: ${ctx.destination.map(ap).join("; ")}`,
    `Travel date: ${ctx.date} (${ctx.daysAhead === 0 ? "today" : `${ctx.daysAhead} day(s) from now`})`,
    ctx.timeOfDay ? `Preferred time of day: ${ctx.timeOfDay}` : null,
    ctx.notes ? `Traveller notes: ${ctx.notes}` : null,
    `</trip>`,
    `<sources>\n${JSON.stringify(sources, null, 2)}\n</sources>`,
    `<signals>\n${JSON.stringify(signals, null, 2)}\n</signals>`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function assessWithAi(ctx: AssessContext): Promise<Omit<Assessment, "generatedBy">> {
  const client = getClient();
  if (!client) throw new Error("AI is not configured (set ANTHROPIC_API_KEY)");

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: zodOutputFormat(AssessmentSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: buildPrompt(ctx) }],
  });
  if (response.stop_reason === "refusal") throw new RefusalError("Model declined to assess this trip");
  if (!response.parsed_output) throw new Error(`No structured output (stop_reason: ${response.stop_reason})`);
  return response.parsed_output;
}
