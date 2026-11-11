import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { z } from "zod";
import { parseTripText } from "./ai/parse.js";
import { getClient } from "./ai/client.js";
import { AssessError, assessRequestSchema, runAssessment } from "./assessment.js";
import { authRouter, requireAuth } from "./auth.js";
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

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", ai: getClient() ? "configured" : "not_configured", time: new Date().toISOString() });
  });

  app.use("/auth", authRouter(store));
  app.use("/routes", savedRoutesRouter(store));

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
      res.json(await runAssessment(store, parsed.data));
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
