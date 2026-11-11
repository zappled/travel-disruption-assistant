import cors from "cors";
import express from "express";
import { z } from "zod";

export const assessRequestSchema = z.object({
  origin: z.string().trim().min(1, "origin is required"),
  destination: z.string().trim().min(1, "destination is required"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});

export type AssessRequest = z.infer<typeof assessRequestSchema>;

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  // Placeholder: will gather external signals (weather, airport status, etc.)
  // and use AI to synthesize a disruption assessment.
  app.post("/assess", (req, res) => {
    const parsed = assessRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: z.flattenError(parsed.error) });
      return;
    }

    const { origin, destination, date } = parsed.data;
    res.json({
      route: { origin, destination, date },
      overallRisk: "unknown",
      summary: "Assessment not implemented yet — this is a stub response from the API.",
      risks: [],
      sources: [],
    });
  });

  return app;
}
