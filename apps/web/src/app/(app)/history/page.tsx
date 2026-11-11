"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { api, ApiError, type HistorySummary } from "@/lib/api";
import { headlineWithoutLevel } from "@/lib/riskLevels";

const RISK_LABEL = { low: "Low", moderate: "Moderate", high: "High", severe: "Severe" } as const;

function formatTravelDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function formatChecked(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function PastResultsPage() {
  const { handleAuthError } = useApp();
  const [entries, setEntries] = useState<HistorySummary[] | null>(null);
  const [max, setMax] = useState(20);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listHistory()
      .then(({ entries, max }) => {
        setEntries(entries);
        setMax(max);
      })
      .catch((err) => {
        if (!handleAuthError(err)) setError(err instanceof ApiError ? err.message : "Couldn't load past results.");
      });
  }, [handleAuthError]);

  return (
    <>
      <h1 className="page-title">Past results</h1>
      <p className="muted">
        Results you&apos;ve saved, newest first (up to {max}). Each one is a snapshot of the data at the time you ran it.
      </p>
      {error && <p className="error-text">{error}</p>}

      {entries && entries.length === 0 && (
        <div className="empty">
          <p>
            No saved results yet. <Link href="/">Check a trip</Link> and choose Save result to view it here.
          </p>
        </div>
      )}

      {entries && entries.length > 0 && (
        <ul className="list">
          {entries.map((e) => (
            <li key={e.id} className="list-item history-item" data-risk={e.overallRisk}>
              <Link href={`/history/${e.id}`} className="history-link">
                <span className="list-codes">
                  {e.originCodes.join(" ")} → {e.destinationCodes.join(" ")}
                </span>
                <span className="history-risk">{RISK_LABEL[e.overallRisk]} risk</span>
                <span className="history-headline">{headlineWithoutLevel(e.headline)}</span>
                <span className="small muted">
                  Travel {formatTravelDate(e.request.date)}. Checked {formatChecked(e.createdAt)}.
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
