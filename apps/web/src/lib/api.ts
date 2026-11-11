import type {
  AmbiguousResponse,
  AssessResponse,
  HistoryEntry,
  HistorySummary,
  ParsedTrip,
  SavedRoute,
  User,
} from "@tda/api/types";

export type { AmbiguousResponse, AssessResponse, HistoryEntry, HistorySummary, ParsedTrip, SavedRoute, User };

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: { error?: string; message?: string } & Record<string, unknown>,
  ) {
    super(body.message ?? `Request failed (${status})`);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

const post = <T>(path: string, data?: unknown) =>
  call<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data) });

export const api = {
  me: () => call<{ user: User }>("/auth/me"),
  login: (email: string, password: string) => post<{ user: User }>("/auth/login", { email, password }),
  logout: () => post<void>("/auth/logout"),

  listRoutes: () => call<{ routes: SavedRoute[]; max: number }>("/routes"),
  saveRoute: (r: Omit<SavedRoute, "id" | "createdAt">) => post<{ route: SavedRoute }>("/routes", r),
  updateRoute: (id: string, r: Omit<SavedRoute, "id" | "createdAt">) =>
    call<{ route: SavedRoute }>(`/routes/${id}`, { method: "PUT", body: JSON.stringify(r) }),
  deleteRoute: (id: string) => call<void>(`/routes/${id}`, { method: "DELETE" }),

  listHistory: () => call<{ entries: HistorySummary[]; max: number }>("/history"),
  getHistory: (id: string) => call<{ entry: HistoryEntry }>(`/history/${id}`),
  deleteHistory: (id: string) => call<void>(`/history/${id}`, { method: "DELETE" }),

  parse: (text: string, today: string) => post<{ trip: ParsedTrip }>("/parse", { text, today }),
  assess: (req: { origin: string; destination: string; date: string; timeOfDay?: string | null; notes?: string | null }) =>
    post<AssessResponse & { historyId: string }>("/assess", req),
};

/** Local calendar date as YYYY-MM-DD (not UTC). */
export function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
