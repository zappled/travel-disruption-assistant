import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { z } from "zod";
import { authRouter, requireAuth } from "./auth.js";
import { savedRoutesRouter } from "./savedRoutes.js";
import { MemoryStore, type Store } from "./store.js";

export const assessRequestSchema = z.object({
  origin: z.string().trim().min(1, "origin is required"),
  destination: z.string().trim().min(1, "destination is required"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});

export type AssessRequest = z.infer<typeof assessRequestSchema>;

export function createApp(store: Store = new MemoryStore()) {
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(cors());
  app.use(express.json({ limit: "50kb" }));
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  app.use("/auth", authRouter(store));
  app.use("/routes", savedRoutesRouter(store));

  // Placeholder until the assessment pipeline lands.
  app.post("/assess", requireAuth(store), (req, res) => {
    const parsed = assessRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: z.flattenError(parsed.error) });
      return;
    }
    res.json({ route: parsed.data, stub: true });
  });

  return app;
}
