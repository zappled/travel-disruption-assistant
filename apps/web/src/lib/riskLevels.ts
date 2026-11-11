import type { AssessResponse } from "@/lib/api";

export type RiskLevel = AssessResponse["assessment"]["overallRisk"];

/** Plain-language explanation of each overall risk level, shown with results. */
export const RISK_LEVELS: { level: RiskLevel; label: string; meaning: string; todo: string }[] = [
  {
    level: "low",
    label: "Low",
    meaning: "No significant weather or air-traffic issues found for your airports and travel window.",
    todo: "Travel as normal and check your flight status on the day.",
  },
  {
    level: "moderate",
    label: "Moderate",
    meaning:
      "Some disruption is possible: showers, gusty winds, fog, or minor delays at one airport. Usually short delays, rarely cancellations.",
    todo: "Turn on airline alerts, check your flight status before leaving, and allow extra time at the airport.",
  },
  {
    level: "high",
    label: "High",
    meaning:
      "Significant disruption is likely: thunderstorms or snow in your window, an FAA delay program, or several issues together. Long delays and missed connections are plausible.",
    todo: "Consider an earlier or later flight or another airport, check for airline travel waivers, and avoid tight connections.",
  },
  {
    level: "severe",
    label: "Severe",
    meaning: "Major disruption is happening or expected: a ground stop, an airport closure, a blizzard or hurricane. Cancellations are likely.",
    todo: "Contact your airline now about rebooking, and consider postponing the trip.",
  },
];
