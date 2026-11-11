# Travel Disruption Assistant

Enter a US travel route and date and get an assessment of potential disruptions, with the evidence behind each risk and suggested actions.

## Structure

npm workspaces monorepo:

| Path        | What                                   | Port |
| ----------- | -------------------------------------- | ---- |
| `apps/web`  | Next.js frontend (App Router, Tailwind) | 3000 |
| `apps/api`  | Express + TypeScript backend           | 4000 |

The frontend proxies `/api/*` to the backend (see `apps/web/next.config.ts`), so the browser never calls the API cross-origin. Override the target with `API_URL`.

## Getting started

```bash
npm install
cp apps/api/.env.example apps/api/.env   # optional
npm run dev                              # starts api + web together
```

Then open http://localhost:3000.

## Scripts (from repo root)

- `npm run dev` – run both apps
- `npm run dev:api` / `npm run dev:web` – run one app
- `npm run build` – build both
- `npm run typecheck` – type-check both
- `npm run lint` – lint

## API

- `GET /health` – liveness check
- `POST /assess` – body `{ origin, destination, date: "YYYY-MM-DD" }` (currently a stub)
