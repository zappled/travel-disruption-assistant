"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Results } from "@/components/Results";
import { api, ApiError, localDate, type AmbiguousResponse, type AssessResponse, type SavedRoute, type User } from "@/lib/api";

const MAX_DAYS = 14;
const DRAFT_KEY = "tripcheck:draft";

interface Trip {
  prompt: string;
  origin: string;
  destination: string;
  date: string;
  timeOfDay: string;
  notes: string;
}

const STEPS = ["Finding your airports", "Checking FAA airspace status", "Reading weather forecasts and alerts", "Weighing the evidence"];

function emptyTrip(): Trip {
  // Date is filled in client-side after login (current time can't be read during prerender).
  return { prompt: "", origin: "", destination: "", date: "", timeOfDay: "", notes: "" };
}

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [maxRoutes, setMaxRoutes] = useState(5);
  const [trip, setTrip] = useState<Trip>(emptyTrip);

  const [parsing, setParsing] = useState(false);
  const [parseNote, setParseNote] = useState<string | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<AssessResponse | null>(null);
  const [ambiguous, setAmbiguous] = useState<AmbiguousResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveLabel, setSaveLabel] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const set = (patch: Partial<Trip>) => setTrip((t) => ({ ...t, ...patch }));

  /** Session expired mid-use: keep what they typed, send them to log in. */
  const handleAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        try {
          sessionStorage.setItem(DRAFT_KEY, JSON.stringify(trip));
        } catch {}
        router.replace("/login");
        return true;
      }
      return false;
    },
    [router, trip],
  );

  useEffect(() => {
    api
      .me()
      .then(({ user }) => {
        setUser(user);
        let draft: Partial<Trip> = {};
        try {
          const saved = sessionStorage.getItem(DRAFT_KEY);
          if (saved) {
            draft = JSON.parse(saved);
            sessionStorage.removeItem(DRAFT_KEY);
          }
        } catch {}
        setTrip((t) => ({ ...t, ...draft, date: draft.date || t.date || localDate(1) }));
        return api.listRoutes();
      })
      .then(({ routes, max }) => {
        setRoutes(routes);
        setMaxRoutes(max);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

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
      if (!handleAuthError(err)) setParseNote(err instanceof ApiError ? err.message : "Couldn't interpret that. Fill in the fields below instead.");
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
      if (handleAuthError(err)) return;
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
    setTrip({ ...emptyTrip(), date: trip.date, prompt: r.prompt ?? "", origin: r.origin, destination: r.destination });
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
        origin: trip.origin,
        destination: trip.destination,
        prompt: trip.prompt.trim() || null,
      });
      setRoutes((rs) => [...rs, route]);
      setSaveLabel(null);
    } catch (err) {
      if (!handleAuthError(err)) setSaveError(err instanceof ApiError ? err.message : "Couldn't save this route.");
    }
  }

  async function removeRoute(id: string) {
    try {
      await api.deleteRoute(id);
      setRoutes((rs) => rs.filter((r) => r.id !== id));
    } catch (err) {
      handleAuthError(err);
    }
  }

  async function logout() {
    await api.logout().catch(() => {});
    router.replace("/login");
  }

  if (!user) return null;

  const canAssess = trip.origin.trim() && trip.destination.trim() && trip.date && !assessing;
  const routeFull = routes.length >= maxRoutes;
  const alreadySaved = routes.some(
    (r) => r.origin.toLowerCase() === trip.origin.trim().toLowerCase() && r.destination.toLowerCase() === trip.destination.trim().toLowerCase(),
  );

  return (
    <div className="shell">
      <header className="topbar">
        <Link className="wordmark" href="/">
          Trip Check
        </Link>
        <div className="topbar-user">
          <span>{user.email}</span>
          <button className="btn-link" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      {routes.length > 0 && (
        <nav className="saved" aria-label="Saved routes">
          {routes.map((r) => (
            <span className="saved-chip" key={r.id}>
              <button onClick={() => applyRoute(r)} title={r.prompt ?? undefined}>
                {r.label}
                <span className="codes">
                  {r.origin} → {r.destination}
                </span>
              </button>
              <button className="saved-remove" onClick={() => removeRoute(r.id)} aria-label={`Remove saved route ${r.label}`}>
                ×
              </button>
            </span>
          ))}
          <span className="small muted">
            {routes.length} of {maxRoutes} saved
          </span>
        </nav>
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
            <button
              type="button"
              className="btn-link"
              disabled={!trip.origin.trim() || !trip.destination.trim() || routeFull || alreadySaved}
              onClick={() => {
                setSaveError(null);
                setSaveLabel(`${trip.origin.trim()} to ${trip.destination.trim()}`.slice(0, 60));
              }}
            >
              {alreadySaved ? "Route saved" : routeFull ? `${maxRoutes} routes saved. Remove one to save this.` : "Save route"}
            </button>
          ) : (
            <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input
                className="input"
                style={{ width: 220 }}
                aria-label="Route name"
                value={saveLabel}
                maxLength={60}
                onChange={(e) => setSaveLabel(e.target.value)}
                autoFocus
              />
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
        <p className="notice" role="alert" style={{ borderColor: "var(--risk-severe)" }}>
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

      {result && <Results data={result} />}

      {!result && !assessing && !ambiguous && !error && (
        <p className="muted small" style={{ marginTop: 24 }}>
          Trip Check combines live FAA airspace status, National Weather Service forecasts and alerts, aviation forecasts, and Open-Meteo
          weather data, then summarises what could disrupt your trip and what to do about it.
        </p>
      )}
    </div>
  );
}
