"use client";

import { useEffect } from "react";
import { authProvider } from "@/lib/auth/local-auth-provider";
import { useAppStore } from "@/hooks/use-app-store";
import type { AccountProfile } from "@/lib/auth/types";

/** Populates useAppStore's `account` from the local auth provider's own
 * session on mount, and returns it. See local-auth-provider.ts for why
 * this reads from localStorage rather than a real backend. */
export function useAuthSession(): AccountProfile | null {
  const account = useAppStore((s) => s.account);
  const setAccount = useAppStore((s) => s.setAccount);

  useEffect(() => {
    setAccount(authProvider.getSession());
  }, [setAccount]);

  return account;
}
