"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { takeDraft, useApp } from "@/components/AppShell";
import { Results } from "@/components/Results";
import { api, ApiError, localDate, type AmbiguousResponse, type AssessResponse, type SavedRoute } from "@/lib/api";

const MAX_DAYS = 14;

interface Trip {
  prompt: string;
  origin: string;
  destination: string;
  date: string;
  timeOfDay: string;
  notes: string;
}

const STEPS = ["Finding your airports", "Checking FAA airspace status", "Reading weather forecasts and alerts", "Weighing the evidence"];

/** Runs client-side only: AppShell renders pages after login. */
function initialTrip(): Trip {
  const base: Trip = { prompt: "", origin: "", destination: "", date: localDate(1), timeOfDay: "", notes: "" };
  const draft = takeDraft();
  if (!draft) return base;
  // A past date (e.g. re-running an old result) falls back to tomorrow.
  const date = draft.date && draft.date >= localDate() ? draft.date : base.date;
  return { ...base, ...draft, date };
}

export default function CheckPage() {
  const { routes, setRoutes, maxRoutes, handleAuthError } = useApp();
  const [trip, setTrip] = useState<Trip>(initialTrip);

  const [parsing, setParsing] = useState(false);
  const [parseNote, setParseNote] = useState<string | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<(AssessResponse & { historyId: string }) | null>(null);
  const [ambiguous, setAmbiguous] = useState<AmbiguousResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveLabel, setSaveLabel] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const set = (patch: Partial<Trip>) => setTrip((t) => ({ ...t, ...patch }));

  useEffect(() => {
    if (!assessing) return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 1600);
    return () => clearInterval(t);
  }, [assessing]);

  async function fillFromPrompt() {
    if (!trip.prompt.trim()) return;
    setParsing(true);
    setParseNote(null);
    try {
      const { trip: p } = await api.parse(trip.prompt, localDate());
      set({
        origin: p.origin ?? trip.origin,
        destination: p.destination ?? trip.destination,
        date: p.date ?? trip.date,
        timeOfDay: p.timeOfDay ?? "",
        notes: p.notes ?? "",
      });
      const missing = [!p.origin && "where you're flying from", !p.destination && "where you're going", !p.date && "the date"].filter(Boolean);
      setParseNote(missing.length ? `Filled in what I could. Please add ${missing.join(" and ")}.` : "Check the details below, then run the check.");
    } catch (err) {
      if (!handleAuthError(err, trip)) setParseNote(err instanceof ApiError ? err.message : "Couldn't interpret that. Fill in the fields below instead.");
    } finally {
      setParsing(false);
    }
  }

  async function assess(override?: Partial<Trip>) {
    const t = { ...trip, ...override };
    if (override) setTrip(t);
    setStep(0);
    setAssessing(true);
    setError(null);
    setAmbiguous(null);
    setResult(null);
    setSaveLabel(null);
    try {
      setResult(
        await api.assess({
          origin: t.origin,
          destination: t.destination,
          date: t.date,
          timeOfDay: t.timeOfDay || null,
          notes: t.notes || null,
        }),
      );
    } catch (err) {
      if (handleAuthError(err, t)) return;
      if (err instanceof ApiError && err.body.error === "ambiguous_location") {
        setAmbiguous(err.body as unknown as AmbiguousResponse);
      } else {
        setError(err instanceof ApiError ? err.message : "Couldn't reach the server. Check that the API is running.");
      }
    } finally {
      setAssessing(false);
    }
  }

  function chooseAirport(query: string, iata: string) {
    const patch: Partial<Trip> = {};
    if (trip.origin === query) patch.origin = iata;
    if (trip.destination === query) patch.destination = iata;
    assess(patch);
  }

  function applyRoute(r: SavedRoute) {
    setTrip((t) => ({ ...t, prompt: r.prompt ?? "", origin: r.origin, destination: r.destination, timeOfDay: "", notes: "" }));
    setResult(null);
    setAmbiguous(null);
    setError(null);
  }

  async function saveRoute() {
    if (!saveLabel?.trim()) return;
    setSaveError(null);
    try {
      const { route } = await api.saveRoute({
        label: saveLabel.trim(),
        origin: trip.origin.trim(),
        destination: trip.destination.trim(),
        prompt: trip.prompt.trim() || null,
      });
      setRoutes((rs) => [...rs, route]);
      setSaveLabel(null);
    } catch (err) {
      if (!handleAuthError(err, trip)) setSaveError(err instanceof ApiError ? err.message : "Couldn't save this route.");
    }
  }

  const canAssess = trip.origin.trim() && trip.destination.trim() && trip.date && !assessing;
  const routeFull = routes.length >= maxRoutes;
  const alreadySaved = routes.some(
    (r) => r.origin.toLowerCase() === trip.origin.trim().toLowerCase() && r.destination.toLowerCase() === trip.destination.trim().toLowerCase(),
  );

  return (
    <>
      <h1 className="page-title">Check your trip</h1>

      {routes.length > 0 && (
        <div className="saved" aria-label="Use a saved route">
          {routes.map((r) => (
            <span className="saved-chip" key={r.id}>
              <button onClick={() => applyRoute(r)} title={r.prompt ?? undefined}>
                {r.label}
                <span className="codes">
                  {r.origin} → {r.destination}
                </span>
              </button>
            </span>
          ))}
        </div>
      )}

      <form
        className="planner"
        onSubmit={(e) => {
          e.preventDefault();
          if (canAssess) assess();
        }}
      >
        <div className="planner-describe">
          <label className="field" htmlFor="prompt">
            Describe your trip
          </label>
          <div className="planner-describe-row">
            <textarea
              id="prompt"
              className="textarea"
              placeholder="e.g. Flying NYC to San Francisco tomorrow evening, connecting through Denver"
              value={trip.prompt}
              onChange={(e) => set({ prompt: e.target.value })}
              maxLength={500}
            />
            <button type="button" className="btn btn-secondary" onClick={fillFromPrompt} disabled={parsing || !trip.prompt.trim()}>
              {parsing ? "Reading…" : "Fill in details"}
            </button>
          </div>
          {parseNote && <span className="small muted">{parseNote}</span>}
        </div>

        <div className="planner-grid">
          <label className="field">
            From
            <input className="input" value={trip.origin} onChange={(e) => set({ origin: e.target.value })} placeholder="City or airport code" required />
          </label>
          <label className="field">
            To
            <input className="input" value={trip.destination} onChange={(e) => set({ destination: e.target.value })} placeholder="City or airport code" required />
          </label>
          <label className="field">
            Date
            <input className="input" type="date" value={trip.date} min={localDate()} max={localDate(MAX_DAYS)} onChange={(e) => set({ date: e.target.value })} required />
          </label>
          <label className="field">
            Time of day
            <select className="input" value={trip.timeOfDay} onChange={(e) => set({ timeOfDay: e.target.value })}>
              <option value="">Any time</option>
              <option value="morning">Morning</option>
              <option value="afternoon">Afternoon</option>
              <option value="evening">Evening</option>
              <option value="overnight">Overnight / red-eye</option>
            </select>
          </label>
          {trip.notes && (
            <label className="field span-2">
              Notes
              <input className="input" value={trip.notes} onChange={(e) => set({ notes: e.target.value })} />
            </label>
          )}
        </div>

        <div className="planner-actions">
          <button className="btn btn-primary" type="submit" disabled={!canAssess}>
            {assessing ? "Checking…" : "Check this trip"}
          </button>
          {saveLabel === null ? (
            routeFull && !alreadySaved ? (
              <span className="small muted">
                {maxRoutes} routes saved. <Link href="/routes">Manage saved routes</Link> to make room.
              </span>
            ) : (
              <button
                type="button"
                className="btn-link"
                disabled={!trip.origin.trim() || !trip.destination.trim() || alreadySaved}
                onClick={() => {
                  setSaveError(null);
                  setSaveLabel(`${trip.origin.trim()} to ${trip.destination.trim()}`.slice(0, 60));
                }}
              >
                {alreadySaved ? "Route saved" : "Save route"}
              </button>
            )
          ) : (
            <span className="inline-save">
              <input className="input" aria-label="Route name" value={saveLabel} maxLength={60} onChange={(e) => setSaveLabel(e.target.value)} autoFocus />
              <button type="button" className="btn btn-secondary" onClick={saveRoute}>
                Save
              </button>
              <button type="button" className="btn-link" onClick={() => setSaveLabel(null)}>
                Cancel
              </button>
            </span>
          )}
        </div>
        {saveError && <p className="error-text">{saveError}</p>}
      </form>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      {ambiguous && (
        <div className="choose" role="alert">
          {ambiguous.choices.map((c) => (
            <div key={c.query}>
              <strong>Which &ldquo;{c.query}&rdquo; do you mean?</strong>
              <div className="choose-options">
                {c.candidates.map((a) => (
                  <button key={a.iata} className="btn btn-secondary" onClick={() => chooseAirport(c.query, a.iata)}>
                    {a.city}, {a.region} ({a.iata})
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {assessing && (
        <div className="checking" aria-live="polite">
          <strong>Checking your trip</strong>
          <ol>
            {STEPS.map((s, i) => (
              <li key={s} className={i < step ? "done" : i === step ? "active" : ""}>
                {s}
              </li>
            ))}
          </ol>
        </div>
      )}

      {result && (
        <>
          <Results data={result} />
          <p className="small muted">
            Saved to <Link href={`/history/${result.historyId}`}>Past results</Link>.
          </p>
        </>
      )}

      {!result && !assessing && !ambiguous && !error && (
        <p className="muted small" style={{ marginTop: 24 }}>
          Trip Check combines live FAA airspace status, National Weather Service forecasts and alerts, aviation forecasts, and Open-Meteo
          weather data, then summarises what could disrupt your trip and what to do about it.
        </p>
      )}
    </>
  );
}
