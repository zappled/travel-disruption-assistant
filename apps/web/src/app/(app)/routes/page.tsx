"use client";

import { useState } from "react";
import { useApp } from "@/components/AppShell";
import { api, ApiError, type SavedRoute } from "@/lib/api";

type RouteFields = Omit<SavedRoute, "id" | "createdAt">;
const EMPTY: RouteFields = { label: "", origin: "", destination: "", prompt: null };

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
        <label className="field span-2">
          Name
          <input className="input" value={f.label} maxLength={60} onChange={(e) => set({ label: e.target.value })} placeholder="e.g. HQ to SF office" required />
        </label>
        <label className="field">
          From
          <input className="input" value={f.origin} onChange={(e) => set({ origin: e.target.value })} placeholder="City or airport code" required />
        </label>
        <label className="field">
          To
          <input className="input" value={f.destination} onChange={(e) => set({ destination: e.target.value })} placeholder="City or airport code" required />
        </label>
        <label className="field span-2">
          Trip description (optional)
          <textarea className="textarea" value={f.prompt ?? ""} maxLength={500} onChange={(e) => set({ prompt: e.target.value })} placeholder="e.g. Usually the Monday 7am flight out of JFK" />
        </label>
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="planner-actions">
        <button className="btn btn-primary" type="submit" disabled={busy || !f.label.trim() || !f.origin.trim() || !f.destination.trim()}>
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
      <h1 className="page-title">Saved routes</h1>
      <p className="muted">
        Routes you fly often, ready to check in one click. You can save up to {maxRoutes}; you have {routes.length}.
      </p>
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
                initial={{ label: r.label, origin: r.origin, destination: r.destination, prompt: r.prompt }}
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
                <h2 className="list-title">{r.label}</h2>
                <div className="list-codes">
                  {r.origin} → {r.destination}
                </div>
                {r.prompt && <p className="list-note">&ldquo;{r.prompt}&rdquo;</p>}
              </div>
              <div className="list-actions">
                <button className="btn btn-primary" onClick={() => openInChecker({ origin: r.origin, destination: r.destination, prompt: r.prompt ?? "" })}>
                  Check this route
                </button>
                <button className="btn-link" onClick={() => setEditing(r.id)}>
                  Edit
                </button>
                <button className="btn-link btn-danger" onClick={() => remove(r)} aria-label={`Remove ${r.label}`}>
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
