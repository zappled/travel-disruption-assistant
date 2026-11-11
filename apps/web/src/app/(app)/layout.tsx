import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";

// Navigations into these pages wait for the client-side login check (AppShell
// renders nothing until /auth/me answers), so they're intentionally not
// instant. This tells Next.js's instant-navigation validation that's expected.
// Real deployment: check the session on the server and render the shell
// immediately, then remove this.
export const instant = false;

// The shell reads the URL (active menu item, /history/[id]) and is entirely
// client-rendered after login, so it sits in a Suspense boundary.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={null}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
