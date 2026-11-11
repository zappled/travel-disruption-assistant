import { z } from "zod";
import { resolveAirports } from "./airports.js";
import { assessWithAi } from "./ai/assess.js";
import { gather } from "./gather.js";
import { rulesAssessment } from "./rules.js";
import type { Store } from "./store.js";
import type {
  AirportChoice,
  AmbiguousResponse,
  AssessResponse,
  Assessment,
  Confidence,
  Signal,
  SourceStatus,
} from "./types.js";

export const MAX_DAYS_AHEAD = 14;

export const assessRequestSchema = z.object({
  origin: z.string().trim().min(1, "Origin is required").max(80),
  destination: z.string().trim().min(1, "Destination is required").max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  timeOfDay: z.enum(["morning", "afternoon", "evening", "overnight"]).nullish(),
  notes: z.string().trim().max(500).nullish(),
});
export type AssessRequest = z.infer<typeof assessRequestSchema>;

export class AssessError extends Error {
  constructor(
    public status: number,
    public body: { error: string; message: string } | AmbiguousResponse,
  ) {
    super(body.message);
  }
}

/** Today's date at a given longitude (approximate local time zone). */
export function localToday(lon: number, now = new Date()): string {
  const offsetMs = Math.round(lon / 15) * 3600_000;
  return new Date(now.getTime() + offsetMs).toISOString().slice(0, 10);
}

const CONF_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * Deterministic ceiling on confidence. The AI can be less confident than
 * this, never more — horizon and missing data are facts, not judgement.
 */
export function confidenceCap(daysAhead: number, sources: SourceStatus[]): { cap: Confidence; reasons: string[] } {
  const reasons: string[] = [];
  let cap: Confidence = "high";
  const lower = (c: Confidence, why: string) => {
    if (CONF_RANK[c] < CONF_RANK[cap]) cap = c;
    reasons.push(why);
  };
  if (daysAhead >= 5) lower("low", `forecasts ${daysAhead} days out are unreliable`);
  else if (daysAhead >= 3) lower("medium", `the trip is ${daysAhead} days away`);
  const failed = sources.filter((s) => s.status === "error").length;
  const partial = sources.filter((s) => s.status === "partial").length;
  if (failed >= 2) lower("low", `${failed} data sources were unavailable`);
  else if (failed === 1 || partial > 0) lower("medium", "some data sources were unavailable");
  return { cap, reasons };
}

/** Drop any AI-stated risk that doesn't cite a real signal. */
export function enforceEvidence(assessment: Omit<Assessment, "generatedBy">, signals: Signal[]) {
  const ids = new Set(signals.map((s) => s.id));
  const risks = assessment.risks
    .map((r) => ({ ...r, evidenceIds: r.evidenceIds.filter((id) => ids.has(id)) }))
    .filter((r) => r.evidenceIds.length > 0);
  return { ...assessment, risks, droppedRisks: assessment.risks.length - risks.length };
}

export async function runAssessment(store: Store, req: AssessRequest): Promise<AssessResponse> {
  // 1. Resolve locations — never guess between ambiguous cities.
  const resolved = { origin: resolveAirports(req.origin), destination: resolveAirports(req.destination) };
  const choices: AirportChoice[] = [];
  for (const [field, r] of Object.entries(resolved)) {
    const query = req[field as "origin" | "destination"];
    if (r.kind === "not_found") {
      throw new AssessError(400, {
        error: "unknown_location",
        message: `Couldn't find a US airport with scheduled service for "${query}". Try a city name or airport code (e.g. SFO).`,
      });
    }
    if (r.kind === "ambiguous") choices.push({ query, candidates: r.candidates });
  }
  if (choices.length) {
    throw new AssessError(409, {
      error: "ambiguous_location",
      message: "Please choose which airport you mean.",
      choices,
    });
  }
  const origin = resolved.origin.kind === "resolved" ? resolved.origin.airports : [];
  const destination = resolved.destination.kind === "resolved" ? resolved.destination.airports : [];
  const destIatas = new Set(destination.map((a) => a.iata));
  if (origin.every((a) => destIatas.has(a.iata))) {
    throw new AssessError(400, { error: "same_route", message: "Origin and destination are the same." });
  }

  // 2. Date checks, relative to the origin's local "today".
  const today = localToday(origin[0].lon);
  const daysAhead = Math.round((Date.parse(req.date) - Date.parse(today)) / 86400_000);
  if (Number.isNaN(daysAhead)) throw new AssessError(400, { error: "invalid_date", message: "Invalid date." });
  if (daysAhead < 0) throw new AssessError(400, { error: "past_date", message: "That date is in the past." });
  if (daysAhead > MAX_DAYS_AHEAD) {
    throw new AssessError(400, {
      error: "too_far_ahead",
      message: `Forecasts aren't available more than ${MAX_DAYS_AHEAD} days ahead. Check back closer to your trip.`,
    });
  }

  // 3. Gather live data and extract signals.
  const airports = [...origin, ...destination.filter((a) => !origin.some((o) => o.iata === a.iata))];
  const { signals, sources } = await gather(store, airports, req.date, daysAhead);

  // 4. Synthesise — AI first, rules as fallback.
  const notices: string[] = [];
  const { cap, reasons } = confidenceCap(daysAhead, sources);
  let assessment: Assessment;
  try {
    const ai = await assessWithAi({ origin, destination, date: req.date, daysAhead, timeOfDay: req.timeOfDay, notes: req.notes, signals, sources });
    const checked = enforceEvidence(ai, signals);
    if (checked.droppedRisks > 0) notices.push(`${checked.droppedRisks} AI-suggested risk(s) were removed because they weren't backed by evidence.`);
    const { droppedRisks: _unused, ...rest } = checked;
    assessment = { ...rest, generatedBy: "ai" };
    if (CONF_RANK[assessment.confidence] > CONF_RANK[cap]) {
      assessment.confidence = cap;
      assessment.confidenceReason = `Capped at ${cap}: ${reasons.join("; ")}.`;
    }
  } catch (err) {
    console.warn("[assess] AI unavailable, using rules:", err instanceof Error ? err.message : err);
    notices.push("The AI summary is unavailable right now, so this assessment was produced by simple rules.");
    // Rules can't weigh conflicting sources the way the AI does, so never claim high confidence.
    const rulesCap: Confidence = CONF_RANK[cap] > CONF_RANK.medium ? "medium" : cap;
    assessment = {
      ...rulesAssessment(signals, daysAhead),
      confidence: rulesCap,
      confidenceReason: `Rules-only assessment${reasons.length ? `; also limited by: ${reasons.join("; ")}` : ""}.`,
    };
  }

  if (daysAhead >= 5) notices.push(`Your trip is ${daysAhead} days away — treat this as an early outlook and check again closer to the date.`);
  if (daysAhead >= 2) notices.push("FAA delay programs reflect current conditions only; they are shown as context, not a forecast.");

  return {
    route: { origin, destination, date: req.date, daysAhead },
    assessment,
    signals,
    sources,
    notices,
    generatedAt: new Date().toISOString(),
  };
}
