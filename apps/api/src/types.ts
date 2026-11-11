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
}

export interface AssessResponse {
  route: {
    origin: Airport[];
    destination: Airport[];
    date: string;
    daysAhead: number;
  };
  assessment: Assessment;
  signals: Signal[];
  sources: SourceStatus[];
  notices: string[];
  generatedAt: string;
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
  timeOfDay: "morning" | "afternoon" | "evening" | "overnight" | null;
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
