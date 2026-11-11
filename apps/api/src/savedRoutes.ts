import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import type { Store } from "./store.js";
import { MAX_SAVED_ROUTES, type SavedRoute } from "./types.js";

// A saved route is its path, an optional usual time of day, and an optional description.
const routeInputSchema = z.object({
  origin: z.string().trim().min(1, "Origin is required").max(80),
  destination: z.string().trim().min(1, "Destination is required").max(80),
  prompt: z.string().trim().max(500).nullish().transform((v) => v || null),
  timeOfDay: z
    .enum(["morning", "afternoon", "evening", "overnight"])
    .nullish()
    .transform((v) => v ?? null),
});

type RouteKey = Pick<SavedRoute, "origin" | "destination" | "timeOfDay">;
const routesKey = (userId: string) => `routes:${userId}`;
/** Same path and same time of day (JFK→SFO morning and evening are different routes). */
const samePath = (a: RouteKey, b: RouteKey) =>
  a.origin.toLowerCase() === b.origin.toLowerCase() &&
  a.destination.toLowerCase() === b.destination.toLowerCase() &&
  (a.timeOfDay ?? null) === (b.timeOfDay ?? null);

export function savedRoutesRouter(store: Store) {
  const router = Router();
  router.use(requireAuth(store));

  const list = (userId: string) => store.get<SavedRoute[]>(routesKey(userId)) ?? [];
  const save = (userId: string, routes: SavedRoute[]) => store.set(routesKey(userId), routes);
  const duplicate = { error: "duplicate", message: "You've already saved this route." };

  router.get("/", (req, res) => {
    res.json({ routes: list(req.user!.id), max: MAX_SAVED_ROUTES });
  });

  router.post("/", (req, res) => {
    const parsed = routeInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input", message: parsed.error.issues[0].message });
      return;
    }
    const routes = list(req.user!.id);
    if (routes.some((r) => samePath(r, parsed.data))) {
      res.status(409).json(duplicate);
      return;
    }
    if (routes.length >= MAX_SAVED_ROUTES) {
      res.status(409).json({
        error: "limit_reached",
        message: `You can save up to ${MAX_SAVED_ROUTES} routes. Remove one first.`,
      });
      return;
    }
    const route: SavedRoute = { id: randomUUID(), createdAt: new Date().toISOString(), ...parsed.data };
    save(req.user!.id, [...routes, route]);
    res.status(201).json({ route });
  });

  router.put("/:id", (req, res) => {
    const parsed = routeInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input", message: parsed.error.issues[0].message });
      return;
    }
    const routes = list(req.user!.id);
    const idx = routes.findIndex((r) => r.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: "not_found", message: "Route not found." });
      return;
    }
    if (routes.some((r, i) => i !== idx && samePath(r, parsed.data))) {
      res.status(409).json(duplicate);
      return;
    }
    const updated: SavedRoute = { ...routes[idx], ...parsed.data };
    routes[idx] = updated;
    save(req.user!.id, routes);
    res.json({ route: updated });
  });

  router.delete("/:id", (req, res) => {
    const routes = list(req.user!.id);
    const next = routes.filter((r) => r.id !== req.params.id);
    if (next.length === routes.length) {
      res.status(404).json({ error: "not_found", message: "Route not found." });
      return;
    }
    save(req.user!.id, next);
    res.status(204).end();
  });

  return router;
}
