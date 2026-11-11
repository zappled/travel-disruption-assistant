"use client";

import { useState } from "react";
import { AirportInput } from "@/components/AirportInput";
import { RouteArrow } from "@/components/RouteArrow";
import { useApp } from "@/components/AppShell";
import { TIME_WINDOWS, type TimeOfDay } from "@tda/api/types";
import { api, ApiError, type SavedRoute } from "@/lib/api";

type RouteFields = Omit<SavedRoute, "id" | "createdAt">;
const EMPTY: RouteFields = { origin: "", destination: "", prompt: null, timeOfDay: null };
const TIME_KEYS = Object.keys(TIME_WINDOWS) as TimeOfDay[];

/** "Morning (5am–12pm)" */
function timeLabel(t: TimeOfDay) {
  return `${TIME_WINDOWS[t].label} (${TIME_WINDOWS[t].range})`;
}

function RouteForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: RouteFields;
  submitLabel: string;
  onSubmit: (r: RouteFields) => Promise<void>;
  onCancel?: () => void;
}) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<RouteFields>) => setF((x) => ({ ...x, ...patch }));

  return (
    <form
      className="route-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSubmit({ ...f, prompt: f.prompt?.trim() || null });
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Couldn't save this route.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="planner-grid">
        <AirportInput label="From" value={f.origin} onChange={(origin) => set({ origin })} />
        <AirportInput label="To" value={f.destination} onChange={(destination) => set({ destination })} />
        <label className="field">
          Usual time of day
          <select
            className="input"
            value={f.timeOfDay ?? ""}
            onChange={(e) => set({ timeOfDay: (e.target.value || null) as TimeOfDay | null })}
          >
            <option value="">Any time</option>
            {TIME_KEYS.map((k) => (
              <option key={k} value={k}>
                {timeLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="field span-2">
          Description (optional)
          <textarea className="textarea" value={f.prompt ?? ""} maxLength={500} onChange={(e) => set({ prompt: e.target.value })} placeholder="e.g. Usually the Monday 7am flight out of JFK" />
        </label>
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="planner-actions">
        <button className="btn btn-primary" type="submit" disabled={busy || !f.origin.trim() || !f.destination.trim()}>
          {busy ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn-link" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export default function SavedRoutesPage() {
  const { routes, setRoutes, maxRoutes, handleAuthError, openInChecker } = useApp();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guarded(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (err) {
      if (!handleAuthError(err)) throw err;
    }
  }

  async function remove(r: SavedRoute) {
    setError(null);
    try {
      await guarded(async () => {
        await api.deleteRoute(r.id);
        setRoutes((rs) => rs.filter((x) => x.id !== r.id));
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't remove this route.");
    }
  }

  const full = routes.length >= maxRoutes;

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Saved routes</h1>
        <span className="route-count" aria-live="polite">
          <strong>
            {routes.length}/{maxRoutes}
          </strong>{" "}
          routes saved
        </span>
      </div>
      <p className="muted">Routes you fly often, ready to check in one click.</p>
      {error && <p className="error-text">{error}</p>}

      {routes.length === 0 && !adding && (
        <div className="empty">
          <p>No saved routes yet. Add one here, or save a route from the trip checker.</p>
        </div>
      )}

      <ul className="list">
        {routes.map((r) =>
          editing === r.id ? (
            <li key={r.id} className="list-item">
              <RouteForm
                initial={{ origin: r.origin, destination: r.destination, prompt: r.prompt, timeOfDay: r.timeOfDay ?? null }}
                submitLabel="Save changes"
                onCancel={() => setEditing(null)}
                onSubmit={(fields) =>
                  guarded(async () => {
                    const { route } = await api.updateRoute(r.id, fields);
                    setRoutes((rs) => rs.map((x) => (x.id === r.id ? route : x)));
                    setEditing(null);
                  })
                }
              />
            </li>
          ) : (
            <li key={r.id} className="list-item">
              <div className="list-main">
                <h2 className="list-codes">
                  {r.origin} <RouteArrow /> {r.destination}
                </h2>
                <p className="list-when">{r.timeOfDay ? timeLabel(r.timeOfDay) : "Any time of day"}</p>
                {r.prompt && <p className="list-note">{r.prompt}</p>}
              </div>
              <div className="list-actions">
                <button className="btn btn-primary" onClick={() =>
                    openInChecker({ origin: r.origin, destination: r.destination, prompt: r.prompt ?? "", timeOfDay: r.timeOfDay ?? "" })
                  }
                >
                  Check this route
                </button>
                <button className="btn-link" onClick={() => setEditing(r.id)}>
                  Edit
                </button>
                <button className="btn-link btn-danger" onClick={() => remove(r)} aria-label={`Remove ${r.origin} to ${r.destination}`}>
                  Remove
                </button>
              </div>
            </li>
          ),
        )}
      </ul>

      {adding ? (
        <div className="list-item" style={{ marginTop: 16 }}>
          <RouteForm
            initial={EMPTY}
            submitLabel="Save route"
            onCancel={() => setAdding(false)}
            onSubmit={(fields) =>
              guarded(async () => {
                const { route } = await api.saveRoute(fields);
                setRoutes((rs) => [...rs, route]);
                setAdding(false);
              })
            }
          />
        </div>
      ) : (
        <div style={{ marginTop: 20 }}>
          <button className="btn btn-secondary" onClick={() => setAdding(true)} disabled={full}>
            Add a route
          </button>
          {full && <span className="small muted" style={{ marginLeft: 12 }}>Remove a route to add another.</span>}
        </div>
      )}
    </>
  );
}
