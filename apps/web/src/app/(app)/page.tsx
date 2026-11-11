"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AirportInput } from "@/components/AirportInput";
import { takeDraft, useApp } from "@/components/AppShell";
import { InfoTip } from "@/components/InfoTip";
import { Results } from "@/components/Results";
import { TIME_WINDOWS } from "@tda/api/types";
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

const AI_PANEL_KEY = "tripcheck:ai-panel-open";

/** Last open/closed choice for the AI panel in this browser (default open). */
function readAiPanelPref(): boolean {
  try {
    return localStorage.getItem(AI_PANEL_KEY) !== "false";
  } catch {
    return true;
  }
}

export default function CheckPage() {
  const { routes, setRoutes, maxRoutes, handleAuthError } = useApp();
  const [trip, setTrip] = useState<Trip>(initialTrip);
  // Open if the incoming draft has a description to show; otherwise the user's last choice.
  const [aiOpen, setAiOpen] = useState(() => Boolean(trip.prompt) || readAiPanelPref());

  function toggleAiPanel(open: boolean) {
    setAiOpen(open);
    try {
      localStorage.setItem(AI_PANEL_KEY, String(open));
    } catch {}
  }

  const [parsing, setParsing] = useState(false);
  const [parseNote, setParseNote] = useState<string | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<(AssessResponse & { resultId: string }) | null>(null);
  const [resultSave, setResultSave] = useState<"idle" | "saving" | "saved">("idle");
  const [ambiguous, setAmbiguous] = useState<AmbiguousResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<{ origin: string; destination: string; prompt: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
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
    setResultSave("idle");
    setSaveError(null);
    try {
      const res = await api.assess({
        origin: t.origin,
        destination: t.destination,
        date: t.date,
        timeOfDay: t.timeOfDay || null,
        notes: t.notes || null,
      });
      setResult(res);
      // Remember exactly what was checked, so "Save route" saves this trip even if the form changes.
      setChecked({ origin: t.origin.trim(), destination: t.destination.trim(), prompt: t.prompt.trim() || null });
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
    if (r.prompt) setAiOpen(true); // show the route's description (doesn't change the saved preference)
    setResult(null);
    setAmbiguous(null);
    setError(null);
  }

  /** One click: the checked route's path, plus its description if there was one. */
  async function saveRoute() {
    if (!checked) return;
    setSaveError(null);
    setSaving(true);
    try {
      const { route } = await api.saveRoute(checked);
      setRoutes((rs) => [...rs, route]);
    } catch (err) {
      if (!handleAuthError(err, trip)) setSaveError(err instanceof ApiError ? err.message : "Couldn't save this route.");
    } finally {
      setSaving(false);
    }
  }

  /** Add this result to Past results (only results saved this way are kept). */
  async function saveResult() {
    if (!result) return;
    setSaveError(null);
    setResultSave("saving");
    try {
      await api.saveResult(result.resultId);
      setResultSave("saved");
    } catch (err) {
      setResultSave("idle");
      if (!handleAuthError(err, trip)) setSaveError(err instanceof ApiError ? err.message : "Couldn't save this result.");
    }
  }

  const canAssess = trip.origin.trim() && trip.destination.trim() && trip.date && !assessing;
  const routeFull = routes.length >= maxRoutes;
  const alreadySaved =
    !!checked &&
    routes.some(
      (r) => r.origin.toLowerCase() === checked.origin.toLowerCase() && r.destination.toLowerCase() === checked.destination.toLowerCase(),
    );

  // Shown in the results toolbar, before "Save as PDF".
  const resultActions = (
    <>
      <button type="button" className="btn btn-secondary" disabled={resultSave !== "idle"} onClick={saveResult}>
        {resultSave === "saved" ? "Result saved" : resultSave === "saving" ? "Saving…" : "Save result"}
      </button>
      {routeFull && !alreadySaved ? (
        <span className="small muted">
          {maxRoutes} routes saved. <Link href="/routes">Manage saved routes</Link> to save this one.
        </span>
      ) : (
        <button type="button" className="btn btn-secondary" disabled={alreadySaved || saving} onClick={saveRoute}>
          {alreadySaved ? "Route saved" : saving ? "Saving…" : "Save route"}
        </button>
      )}
    </>
  );

  return (
    <>
      <h1 className="page-title">Check your trip</h1>
      <p className="muted page-intro">
        Trip Check combines live FAA airspace status, National Weather Service forecasts and alerts, aviation forecasts, and Open-Meteo
        weather data, then summarises what could disrupt your trip and what to do about it.
      </p>

      {routes.length > 0 && (
        <div className="saved" aria-label="Use a saved route">
          {routes.map((r) => (
            <span className="saved-chip" key={r.id}>
              <button onClick={() => applyRoute(r)} title={r.prompt ?? undefined}>
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
        <details className="planner-describe" open={aiOpen} onToggle={(e) => toggleAiPanel(e.currentTarget.open)}>
          <summary>Fill trip details with AI (optional)</summary>
          <div className="planner-describe-row">
            <textarea
              id="prompt"
              aria-label="Describe your trip"
              className="textarea"
              placeholder="e.g. Flying NYC to San Francisco tomorrow evening, connecting through Denver"
              value={trip.prompt}
              onChange={(e) => set({ prompt: e.target.value })}
              maxLength={500}
            />
            <button type="button" className="btn btn-secondary" onClick={fillFromPrompt} disabled={parsing || !trip.prompt.trim()}>
              {parsing ? "Filling…" : "Fill form"}
            </button>
          </div>
          {parseNote && <span className="small muted">{parseNote}</span>}
        </details>

        <div className="planner-grid">
          <AirportInput label="From" value={trip.origin} onChange={(origin) => set({ origin })} />
          <AirportInput label="To" value={trip.destination} onChange={(destination) => set({ destination })} />
          <label className="field">
            Date
            <input className="input" type="date" value={trip.date} min={localDate()} max={localDate(MAX_DAYS)} onChange={(e) => set({ date: e.target.value })} required />
          </label>
          <div className="field">
            <span className="field-label-row">
              <label htmlFor="time-of-day">Time of day</label>
              <InfoTip id="time-of-day-hint" text="Departure, in local time" />
            </span>
            <select
              id="time-of-day"
              className="input"
              aria-describedby="time-of-day-hint"
              value={trip.timeOfDay}
              onChange={(e) => set({ timeOfDay: e.target.value })}
            >
              <option value="">Any time</option>
              {(Object.keys(TIME_WINDOWS) as (keyof typeof TIME_WINDOWS)[]).map((k) => (
                <option key={k} value={k}>
                  {TIME_WINDOWS[k].label} ({TIME_WINDOWS[k].range})
                </option>
              ))}
            </select>
          </div>
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
        </div>
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
          <Results data={result} actions={resultActions} actionError={saveError} />
        </>
      )}

    </>
  );
}
