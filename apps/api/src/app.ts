import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { z } from "zod";
import { parseTripText } from "./ai/parse.js";
import { getProviderState } from "./ai/client.js";
import { searchAirports } from "./airports.js";
import { AssessError, assessRequestSchema, runAssessment } from "./assessment.js";
import { authRouter, requireAuth } from "./auth.js";
import { historyRouter, holdResult } from "./history.js";
import { savedRoutesRouter } from "./savedRoutes.js";
import { MemoryStore, type Store } from "./store.js";

const parseRequestSchema = z.object({
  text: z.string().trim().min(1, "Describe your trip").max(500),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export function createApp(store: Store = new MemoryStore()) {
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(cors());
  app.use(express.json({ limit: "50kb" }));
  app.use(cookieParser());

  app.get("/health", async (_req, res) => {
    const { auth, provider } = await getProviderState();
    res.json({
      status: "ok",
      ai: provider ? "configured" : "not_configured",
      aiAuth: auth,
      aiModel: provider?.label ?? null,
      time: new Date().toISOString(),
    });
  });

  app.use("/auth", authRouter(store));
  app.use("/routes", savedRoutesRouter(store));
  app.use("/history", historyRouter(store));

  // Type-ahead for the From/To fields (local dataset, no external calls).
  app.get("/airports/search", requireAuth(store), (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 80) : "";
    res.json({ suggestions: searchAirports(q) });
  });

  // Free text → structured trip fields (user confirms them before assessing).
  app.post("/parse", requireAuth(store), async (req, res) => {
    const parsed = parseRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input", message: parsed.error.issues[0].message });
      return;
    }
    try {
      const today = parsed.data.today ?? new Date().toISOString().slice(0, 10);
      res.json({ trip: await parseTripText(parsed.data.text, today) });
    } catch (err) {
      console.warn("[parse] failed:", err instanceof Error ? err.message : err);
      res.status(503).json({
        error: "parse_unavailable",
        message: "Couldn't interpret that right now — please fill in the fields below.",
      });
    }
  });

  app.post("/assess", requireAuth(store), async (req, res) => {
    const parsed = assessRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input", message: parsed.error.issues[0].message });
      return;
    }
    try {
      const result = await runAssessment(store, parsed.data);
      // Not saved to Past results unless the user clicks "Save result" (POST /history).
      const resultId = holdResult(
        store,
        req.user!.id,
        {
          origin: parsed.data.origin,
          destination: parsed.data.destination,
          date: parsed.data.date,
          timeOfDay: parsed.data.timeOfDay ?? null,
          notes: parsed.data.notes ?? null,
        },
        result,
      );
      res.json({ ...result, resultId });
    } catch (err) {
      if (err instanceof AssessError) {
        res.status(err.status).json(err.body);
        return;
      }
      console.error("[assess] unexpected error:", err);
      res.status(500).json({ error: "internal", message: "Something went wrong while assessing this trip." });
    }
  });

  return app;
}
