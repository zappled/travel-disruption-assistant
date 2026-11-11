/**
 * Shared API types. Kept dependency-free so the web app can import them
 * type-only via "@tda/api/types".
 */

export interface Airport {
  iata: string;
  icao: string | null;
  name: string;
  city: string;
  region: string;
  country: string;
  size: "large" | "medium" | "small";
  lat: number;
  lon: number;
}

export type SourceId = "faa" | "nws" | "awc" | "openMeteo";

export interface SourceStatus {
  source: SourceId;
  name: string;
  url: string;
  status: "ok" | "partial" | "error" | "skipped";
  fetchedAt: string;
  detail?: string;
}

export type SignalKind =
  | "ground_stop"
  | "ground_delay"
  | "airport_delay"
  | "closure"
  | "nws_alert"
  | "thunderstorm"
  | "snow_ice"
  | "high_wind"
  | "low_visibility"
  | "heavy_rain"
  | "fair_weather";

export type TimeOfDay = "morning" | "afternoon" | "evening" | "overnight";

/**
 * Departure windows in the origin airport's local time. Hours past 24 run into
 * the next day (overnight = 10pm to 5am). Shared with the web app's dropdown.
 */
export const TIME_WINDOWS: Record<TimeOfDay, { label: string; startHour: number; endHour: number; range: string }> = {
  morning: { label: "Morning", startHour: 5, endHour: 12, range: "5am–12pm" },
  afternoon: { label: "Afternoon", startHour: 12, endHour: 17, range: "12pm–5pm" },
  evening: { label: "Evening", startHour: 17, endHour: 22, range: "5pm–10pm" },
  overnight: { label: "Overnight / red-eye", startHour: 22, endHour: 29, range: "10pm–5am" },
};

export interface TravelWindow {
  timeOfDay: TimeOfDay;
  /** Departure window at the origin, UTC ISO */
  departStart: string;
  departEnd: string;
  /** Estimated arrival window at the destination (departure + est. flight time), UTC ISO */
  arriveStart: string;
  arriveEnd: string;
  estFlightHours: number;
  /** Human-readable, in each airport's local time */
  description: string;
}

/** 0 = informational, 1 = minor, 2 = significant, 3 = severe */
export type Severity = 0 | 1 | 2 | 3;

export interface Evidence {
  source: SourceId;
  sourceName: string;
  url: string;
  observedAt: string;
  excerpt: string;
}

export interface Signal {
  id: string;
  airport: string; // IATA
  kind: SignalKind;
  severity: Severity;
  summary: string;
  /** "current" = conditions now; "forecast" = for the travel date */
  timing: "current" | "forecast";
  /** Relative to the traveller's time-of-day window, when one was given */
  window?: "inside" | "outside";
  evidence: Evidence;
}

export type RiskLevel = "low" | "moderate" | "high" | "severe";
export type Confidence = "low" | "medium" | "high";

export interface Risk {
  title: string;
  airports: string[];
  likelihood: "unlikely" | "possible" | "likely";
  impact: "minor" | "moderate" | "major";
  explanation: string;
  evidenceIds: string[];
}

export interface Recommendation {
  action: string;
  reason: string;
  priority: "now" | "before_travel" | "day_of_travel";
}

export interface Assessment {
  overallRisk: RiskLevel;
  confidence: Confidence;
  confidenceReason: string;
  headline: string;
  summary: string;
  risks: Risk[];
  recommendations: Recommendation[];
  generatedBy: "ai" | "rules";
  /** Which AI wrote it, e.g. "Claude (claude-opus-5-5)" or "Gemini (gemini-3.8-flash)" */
  aiModel?: string;
}

export interface AssessResponse {
  route: {
    origin: Airport[];
    destination: Airport[];
    date: string;
    daysAhead: number;
    travelWindow: TravelWindow | null;
  };
  assessment: Assessment;
  signals: Signal[];
  sources: SourceStatus[];
  notices: string[];
  generatedAt: string;
}

export interface AirportSuggestion {
  kind: "metro" | "airport";
  /** What gets put in the field: a metro name ("New York") or an IATA code ("PDX"). */
  value: string;
  label: string; // "Portland, OR" or "New York, all airports"
  detail: string; // airport name, or the metro's codes
  codes: string[];
}

export interface AirportChoice {
  query: string;
  candidates: Airport[];
}

export interface AmbiguousResponse {
  error: "ambiguous_location";
  message: string;
  choices: AirportChoice[];
}

export interface ParsedTrip {
  origin: string | null;
  destination: string | null;
  date: string | null;
  timeOfDay: TimeOfDay | null;
  notes: string | null;
}

export interface User {
  id: string;
  email: string;
}

export interface SavedRoute {
  id: string;
  label: string;
  origin: string;
  destination: string;
  prompt: string | null;
  createdAt: string;
}

export const MAX_SAVED_ROUTES = 5;

export interface HistoryEntry {
  id: string;
  createdAt: string;
  /** What the user asked for, so the check can be re-run on fresh data. */
  request: {
    origin: string;
    destination: string;
    date: string;
    timeOfDay: string | null;
    notes: string | null;
  };
  result: AssessResponse;
}

export type HistorySummary = Omit<HistoryEntry, "result"> & {
  overallRisk: RiskLevel;
  confidence: Confidence;
  headline: string;
  originCodes: string[];
  destinationCodes: string[];
};

export const MAX_HISTORY = 20;
