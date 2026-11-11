"use client";

import { useState } from "react";

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function Home() {
  const [origin, setOrigin] = useState("New York");
  const [destination, setDestination] = useState("San Francisco");
  const [date, setDate] = useState(tomorrow);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/assess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin, destination, date }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(body.error ?? body));
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12 font-sans">
      <h1 className="text-2xl font-semibold tracking-tight">Travel Disruption Assistant</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Enter a US route and date to check for potential disruptions.
      </p>

      <form onSubmit={onSubmit} className="mt-8 grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          From
          <input
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          To
          <input
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Date
          <input
            type="date"
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 sm:col-span-3 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {loading ? "Assessing…" : "Assess trip"}
        </button>
      </form>

      {error && <p className="mt-6 text-sm text-red-600">{error}</p>}
      {result !== null && (
        <pre className="mt-6 overflow-x-auto rounded bg-zinc-100 p-4 text-xs dark:bg-zinc-900">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </main>
  );
}
