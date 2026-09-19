"use client";

import { useLayoutEffect, useState } from "react";
import { useAppStore } from "@/hooks/use-app-store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
      }),
  );
  // Layout effect, not a passive one: passive effects of child components
  // (which may call store setters) run first, and the persist middleware
  // would write the still-default state over the saved preferences before
  // rehydrate ever read them. A layout effect runs after hydration commits
  // (no server/client mismatch) but before any passive effect.
  useLayoutEffect(() => {
    void useAppStore.persist.rehydrate();
  }, []);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
