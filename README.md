# Trip Check: Travel Disruption Assistant

Enter a US flight route and date. Trip Check pulls live data from several public sources, turns it into evidence, and uses Claude to explain whether the trip is at risk, why, and what to do.

## Getting started

```bash
npm install
cp apps/api/.env.example apps/api/.env   # set DEMO_EMAIL / DEMO_PASSWORD
ant auth login                           # Claude credentials via the Anthropic CLI (or set ANTHROPIC_API_KEY in .env)
npm run dev                              # API on :4000, web on :3000
```

The API picks an AI provider in this order:

1. **Claude**: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, then an `ant auth login` profile (`~/.config/anthropic`).
2. **Gemini** (free-tier fallback): `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/apikey), used only when no Claude credentials exist.
3. **None**: rules-only assessments.

Both providers return the same schema-validated output, so evidence checks and confidence caps apply equally. The API logs the provider at startup; `GET /health` reports it (`aiAuth`, `aiModel`), and each AI-written result says which model wrote it.

Open http://localhost:3000 and log in with the demo account from `apps/api/.env`. There is no sign-up flow: in a real deployment, users would sign in with their existing work account.
Without `ANTHROPIC_API_KEY` the app still works: it falls back to a rules-only assessment.

| Command | What it does |
| --- | --- |
| `npm run dev` | Run API + web together |
| `npm test -w @tda/api` | API tests (auth, saved routes, airport resolution, signal rules, guardrails) |
| `npm run typecheck` / `npm run lint` / `npm run build` | Checks for both apps |
| `npx tsx apps/api/scripts/probe.ts "New York" "San Francisco" 2026-11-12` | Show live source data and signals without the AI |

## Pages

A side menu (a top bar on narrow screens) switches between:

- **Check your trip** (`/`): describe the trip or fill in the form, then get the assessment. Saved routes appear as one-click shortcuts.
- **Saved routes** (`/routes`): add, edit, remove, and check your up to 5 regular routes.
- **Past results** (`/history`): your last 20 checks, each viewable as a snapshot with "Check again with fresh data".

## Structure

| Path | What |
| --- | --- |
| `apps/web` | Next.js 16 frontend. Proxies `/api/*` to the API, so the session cookie is first-party |
| `apps/api` | Express 5 + TypeScript backend |
| `apps/api/data/airports.json` | 651 US airports with scheduled service, built from [OurAirports](https://ourairports.com/data/) (`npm run build:airports -w @tda/api -- <airports.csv>`) |

## How an assessment works

```
free text ──(Claude: parse)──▶ form fields (user confirms)
                                   │
              resolve airports (metros, ambiguous cities → ask the user)
                                   │
   ┌───────────────┬───────────────┼────────────────┬───────────────┐
   FAA NAS status   NWS forecast +   AWC TAF (≤30h)    Open-Meteo        (parallel, cached,
   (live delays,    alerts           pilot forecast    daily model       failures tolerated)
   closures)
   └───────────────┴───────────────┼────────────────┴───────────────┘
                                   │
            deterministic rules → Signals (S1, S2, …) each with evidence
                                   │
       Claude: overall risk, confidence, risks citing signal IDs, actions
                                   │
     guardrails: drop risks without valid evidence; cap confidence by
     forecast horizon and failed sources; rules-only fallback if AI fails
```

**Design decisions**
- **Rules produce the facts and the AI explains them.** The model only sees signals extracted by rules from real data, and every risk it states must cite signal IDs. The API removes any risk that cites nothing real.
- **Confidence is partly deterministic.** Trips 3+ days out are capped at medium and 5+ days at low; failed sources lower it too. The AI can lower confidence further but can't raise it above the cap.
- **Time of day changes severity.** Morning (5am–12pm), afternoon (12–5pm), evening (5–10pm) and overnight (10pm–5am) are departure windows in the origin's local time. The destination gets an arrival window: departure plus an estimated flight time from great-circle distance. Weather inside a window keeps its severity; weather elsewhere that day drops one level and is labelled. Open-Meteo hourly data, TAF groups, NWS day/night periods, alerts and closures all use these windows. NWS periods are 12-hour blocks, so they're the coarsest source.
- **Current versus forecast.** FAA programs describe conditions *now*. They count fully only for today and tomorrow; otherwise they're shown as context.
- **Never guess locations.** "Portland" asks OR or ME. "New York" checks JFK, LGA and EWR and compares them.
- **Graceful degradation.** Each source can fail independently; the result shows which sources responded.
- **Accounts are kept in memory.** Users, sessions (httpOnly cookie, 7 days), saved routes (max 5) and past results (last 20) sit behind a `Store` interface backed by memory. **Restarting the API wipes them**; the demo user (`DEMO_EMAIL` / `DEMO_PASSWORD`) is re-created from `.env` at startup. Accounts are provisioned, not self-registered.

## API

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Includes whether AI is configured |
| POST | `/auth/login`, `/auth/logout` · GET `/auth/me` | Email + password (scrypt), session cookie, login rate limiting. No sign-up endpoint |
| GET/POST | `/routes` · PUT/DELETE `/routes/:id` | Saved routes, max 5 per user |
| GET | `/history` · GET/DELETE `/history/:id` | Past results: the last 20 assessments per user, stored as full snapshots with the original request |
| GET | `/airports/search?q=` | Suggestions for the From/To fields: exact code, multi-airport city, code prefix, city, airport name |
| POST | `/parse` | `{ text }` → `{ origin, destination, date, timeOfDay, notes }` |
| POST | `/assess` | `{ origin, destination, date, timeOfDay?, notes? }` → assessment, signals, sources, notices. 409 with `choices` for ambiguous cities |

## Before real deployment

- Persistent storage (Redis/Postgres) and company SSO instead of passwords; password reset; CSRF protection on cookie-authenticated POSTs
- Flight-level data (specific flight status, historical on-time performance) from a paid provider
- News/strike/outage signals (e.g. GDELT, airline status pages) and holiday-volume awareness
- An evaluation set of real past disruptions to measure assessment quality and tune the rules
- Rate limiting, request logging/tracing, cost monitoring for AI calls, and a privacy review
