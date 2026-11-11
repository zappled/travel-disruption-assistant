"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await (mode === "login" ? api.login(email, password) : api.signup(email, password));
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server. Check that the API is running.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <h1>Trip Check</h1>
      <p className="muted">
        {mode === "login"
          ? "Log in to check your route for weather and air-traffic disruptions."
          : "Create an account to save up to 5 routes you fly often."}
      </p>
      <form onSubmit={onSubmit} noValidate>
        <label className="field">
          Work email
          <input
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="field">
          Password
          <input
            className="input"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {mode === "signup" && <span className="muted small">At least 8 characters.</span>}
        </label>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {mode === "login" ? (busy ? "Logging in…" : "Log in") : busy ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="small muted" style={{ marginTop: 20 }}>
        {mode === "login" ? (
          <>
            New here? <Link href="/signup">Create an account</Link>
          </>
        ) : (
          <>
            Already have an account? <Link href="/login">Log in</Link>
          </>
        )}
      </p>
    </main>
  );
}
