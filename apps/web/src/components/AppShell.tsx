"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, ApiError, type SavedRoute, type User } from "@/lib/api";

export const DRAFT_KEY = "tripcheck:draft";

export interface TripDraft {
  prompt?: string;
  origin?: string;
  destination?: string;
  date?: string;
  timeOfDay?: string;
  notes?: string;
}

interface AppState {
  user: User;
  routes: SavedRoute[];
  setRoutes: React.Dispatch<React.SetStateAction<SavedRoute[]>>;
  maxRoutes: number;
  /** Redirects to login on 401 (keeping `draft` for after login). Returns true if handled. */
  handleAuthError: (err: unknown, draft?: TripDraft) => boolean;
  /** Pre-fill the Check page and go there. */
  openInChecker: (draft: TripDraft) => void;
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppShell");
  return ctx;
}

export function writeDraft(draft: TripDraft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {}
}

/** Read and clear a pending draft (from another page or an expired session). */
export function takeDraft(): TripDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(DRAFT_KEY);
    return JSON.parse(raw) as TripDraft;
  } catch {
    return null;
  }
}

const NAV = [
  { href: "/", label: "Check your trip", match: (p: string) => p === "/" },
  { href: "/routes", label: "Saved routes", match: (p: string) => p.startsWith("/routes") },
  { href: "/history", label: "Past results", match: (p: string) => p.startsWith("/history") },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [maxRoutes, setMaxRoutes] = useState(5);

  useEffect(() => {
    api
      .me()
      .then(({ user }) => {
        setUser(user);
        return api.listRoutes();
      })
      .then(({ routes, max }) => {
        setRoutes(routes);
        setMaxRoutes(max);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  const handleAuthError = useCallback(
    (err: unknown, draft?: TripDraft) => {
      if (err instanceof ApiError && err.status === 401) {
        if (draft) writeDraft(draft);
        router.replace("/login");
        return true;
      }
      return false;
    },
    [router],
  );

  const openInChecker = useCallback(
    (draft: TripDraft) => {
      writeDraft(draft);
      router.push("/");
    },
    [router],
  );

  async function logout() {
    await api.logout().catch(() => {});
    router.replace("/login");
  }

  if (!user) return null;

  return (
    <AppContext.Provider value={{ user, routes, setRoutes, maxRoutes, handleAuthError, openInChecker }}>
      <div className="app">
        <aside className="sidenav">
          <Link className="wordmark" href="/">
            Trip Check
          </Link>
          <nav aria-label="Main">
            <ul>
              {NAV.map((item) => {
                const active = item.match(pathname);
                return (
                  <li key={item.href}>
                    <Link href={item.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
                      {item.label}
                      {item.href === "/routes" && routes.length > 0 && (
                        <span className="nav-count">
                          {routes.length}/{maxRoutes}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="sidenav-user">
            <span title={user.email}>{user.email}</span>
            <button className="btn-link" onClick={logout}>
              Log out
            </button>
          </div>
        </aside>
        <main className="app-main">{children}</main>
      </div>
    </AppContext.Provider>
  );
}
