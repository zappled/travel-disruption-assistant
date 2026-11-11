# Trip Check: Travel Disruption Assistant

Enter a US flight route and date. Trip Check pulls live data from several public sources, turns it into evidence, and uses Claude to explain whether the trip is at risk, why, and what to do.

## Getting started

```bash
npm install
cp apps/api/.env.example apps/api/.env   # add ANTHROPIC_API_KEY; set DEMO_EMAIL / DEMO_PASSWORD
npm run dev                              # API on :4000, web on :3000
```

Open http://localhost:3000 and log in with the demo account, or sign up.
Without `ANTHROPIC_API_KEY` the app still works: it falls back to a rules-only assessment.

| Command | What it does |
| --- | --- |
| `npm run dev` | Run API + web together |
| `npm test -w @tda/api` | API tests (auth, saved routes, airport resolution, signal rules, guardrails) |
| `npm run typecheck` / `npm run lint` / `npm run build` | Checks for both apps |
| `npx tsx apps/api/scripts/probe.ts "New York" "San Francisco" 2026-11-12` | Show live source data and signals without the AI |

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
- **Current versus forecast.** FAA programs describe conditions *now*. They count fully only for today and tomorrow; otherwise they're shown as context.
- **Never guess locations.** "Portland" asks OR or ME. "New York" checks JFK, LGA and EWR and compares them.
- **Graceful degradation.** Each source can fail independently; the result shows which sources responded.
- **Accounts are kept in memory.** Users, sessions (httpOnly cookie, 7 days) and saved routes (max 5) sit behind a `Store` interface backed by memory. **Restarting the API wipes them**; the demo user is re-created from `.env`.

## API

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Includes whether AI is configured |
| POST | `/auth/signup`, `/auth/login`, `/auth/logout` · GET `/auth/me` | Email + password (scrypt), session cookie, login rate limiting |
| GET/POST | `/routes` · PUT/DELETE `/routes/:id` | Saved routes, max 5 per user |
| POST | `/parse` | `{ text }` → `{ origin, destination, date, timeOfDay, notes }` |
| POST | `/assess` | `{ origin, destination, date, timeOfDay?, notes? }` → assessment, signals, sources, notices. 409 with `choices` for ambiguous cities |

## Before real deployment

- Persistent storage (Redis/Postgres) and company SSO instead of passwords; password reset; CSRF protection on cookie-authenticated POSTs
- Flight-level data (specific flight status, historical on-time performance) from a paid provider
- News/strike/outage signals (e.g. GDELT, airline status pages) and holiday-volume awareness
- An evaluation set of real past disruptions to measure assessment quality and tune the rules
- Rate limiting, request logging/tracing, cost monitoring for AI calls, and a privacy review
