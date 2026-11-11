"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Results } from "@/components/Results";
import { api, ApiError, type HistoryEntry } from "@/lib/api";

export default function PastResultPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { handleAuthError, openInChecker } = useApp();
  const [entry, setEntry] = useState<HistoryEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getHistory(id)
      .then(({ entry }) => setEntry(entry))
      .catch((err) => {
        if (!handleAuthError(err)) setError(err instanceof ApiError ? err.message : "Couldn't load this result.");
      });
  }, [id, handleAuthError]);

  async function remove() {
    try {
      await api.deleteHistory(id);
      router.push("/history");
    } catch (err) {
      if (!handleAuthError(err)) setError(err instanceof ApiError ? err.message : "Couldn't delete this result.");
    }
  }

  return (
    <>
      <p className="small">
        <Link href="/history">Past results</Link>
      </p>
      {error && <p className="error-text">{error}</p>}
      {entry && (
        <>
          <div className="snapshot-bar">
            <span>
              Snapshot from{" "}
              {new Date(entry.createdAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.
              Conditions may have changed since.
            </span>
            <span className="snapshot-actions">
              <button className="btn btn-primary" onClick={() => openInChecker({ ...entry.request, timeOfDay: entry.request.timeOfDay ?? "", notes: entry.request.notes ?? "" })}>
                Check again with fresh data
              </button>
              <button className="btn-link btn-danger" onClick={remove}>
                Delete
              </button>
            </span>
          </div>
          <Results data={entry.result} />
        </>
      )}
    </>
  );
}
