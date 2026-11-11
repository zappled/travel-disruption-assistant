import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";

// The shell reads the URL (active menu item, /history/[id]) and is entirely
// client-rendered after login, so it sits in a Suspense boundary.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={null}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
