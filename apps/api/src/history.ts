import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import type { Store } from "./store.js";
import { MAX_HISTORY, type AssessResponse, type HistoryEntry, type HistorySummary } from "./types.js";

const historyKey = (userId: string) => `history:${userId}`;
const resultKey = (userId: string, resultId: string) => `result:${userId}:${resultId}`;

/** How long a just-run result can still be saved to Past results. */
const RESULT_TTL_MS = 60 * 60_000;

interface HeldResult {
  request: HistoryEntry["request"];
  result: AssessResponse;
}

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

/**
 * Hold a fresh assessment server-side for a while so the user can choose to
 * save it. Saving references this ID, so the saved copy is the server's own
 * result, not something the browser sends back.
 */
export function holdResult(store: Store, userId: string, request: HistoryEntry["request"], result: AssessResponse): string {
  const resultId = randomUUID();
  store.set<HeldResult>(resultKey(userId, resultId), { request, result }, RESULT_TTL_MS);
  return resultId;
}

/** Add an assessment to Past results; keeps the newest MAX_HISTORY per user. */
export function recordHistory(
  store: Store,
  userId: string,
  request: HistoryEntry["request"],
  result: AssessResponse,
  id: string = randomUUID(),
): HistoryEntry {
  const entry: HistoryEntry = { id, createdAt: result.generatedAt, request, result };
  const list = store.get<HistoryEntry[]>(historyKey(userId)) ?? [];
  store.set(historyKey(userId), [entry, ...list].slice(0, MAX_HISTORY));
  return entry;
}

const saveSchema = z.object({ resultId: z.string().uuid() });

export function historyRouter(store: Store) {
  const router = Router();
  router.use(requireAuth(store));
  const list = (userId: string) => store.get<HistoryEntry[]>(historyKey(userId)) ?? [];
  const notFound = { error: "not_found", message: "That result is no longer available." };

  router.get("/", (req, res) => {
    res.json({ entries: list(req.user!.id).map(summarise), max: MAX_HISTORY });
  });

  // Save a result the user just ran ("Save result"). Idempotent per result.
  router.post("/", (req, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input", message: "Missing or invalid result ID." });
      return;
    }
    const userId = req.user!.id;
    const { resultId } = parsed.data;
    const existing = list(userId).find((e) => e.id === resultId);
    if (existing) {
      res.json({ entry: summarise(existing) });
      return;
    }
    const held = store.get<HeldResult>(resultKey(userId, resultId));
    if (!held) {
      res.status(404).json({ error: "expired", message: "This result can no longer be saved. Run the check again to save a fresh result." });
      return;
    }
    const entry = recordHistory(store, userId, held.request, held.result, resultId);
    res.status(201).json({ entry: summarise(entry) });
  });

  router.get("/:id", (req, res) => {
    const entry = list(req.user!.id).find((e) => e.id === req.params.id);
    if (!entry) {
      res.status(404).json(notFound);
      return;
    }
    res.json({ entry });
  });

  router.delete("/:id", (req, res) => {
    const entries = list(req.user!.id);
    const next = entries.filter((e) => e.id !== req.params.id);
    if (next.length === entries.length) {
      res.status(404).json(notFound);
      return;
    }
    store.set(historyKey(req.user!.id), next);
    res.status(204).end();
  });

  return router;
}
