import { randomUUID } from "node:crypto";
import { Router } from "express";
import { requireAuth } from "./auth.js";
import type { Store } from "./store.js";
import { MAX_HISTORY, type AssessResponse, type HistoryEntry, type HistorySummary } from "./types.js";

const historyKey = (userId: string) => `history:${userId}`;

function summarise(e: HistoryEntry): HistorySummary {
  const { result, ...rest } = e;
  return {
    ...rest,
    overallRisk: result.assessment.overallRisk,
    confidence: result.assessment.confidence,
    headline: result.assessment.headline,
    originCodes: result.route.origin.map((a) => a.iata),
    destinationCodes: result.route.destination.map((a) => a.iata),
  };
}

/** Record a completed assessment; keeps the newest MAX_HISTORY per user. */
export function recordHistory(
  store: Store,
  userId: string,
  request: HistoryEntry["request"],
  result: AssessResponse,
): HistoryEntry {
  const entry: HistoryEntry = { id: randomUUID(), createdAt: result.generatedAt, request, result };
  const list = store.get<HistoryEntry[]>(historyKey(userId)) ?? [];
  store.set(historyKey(userId), [entry, ...list].slice(0, MAX_HISTORY));
  return entry;
}

export function historyRouter(store: Store) {
  const router = Router();
  router.use(requireAuth(store));
  const list = (userId: string) => store.get<HistoryEntry[]>(historyKey(userId)) ?? [];

  router.get("/", (req, res) => {
    res.json({ entries: list(req.user!.id).map(summarise), max: MAX_HISTORY });
  });

  router.get("/:id", (req, res) => {
    const entry = list(req.user!.id).find((e) => e.id === req.params.id);
    if (!entry) {
      res.status(404).json({ error: "not_found", message: "That result is no longer available." });
      return;
    }
    res.json({ entry });
  });

  router.delete("/:id", (req, res) => {
    const entries = list(req.user!.id);
    const next = entries.filter((e) => e.id !== req.params.id);
    if (next.length === entries.length) {
      res.status(404).json({ error: "not_found", message: "That result is no longer available." });
      return;
    }
    store.set(historyKey(req.user!.id), next);
    res.status(204).end();
  });

  return router;
}
