"use client";

import type { AccountProfile, AuthProvider, CreateAccountInput, SignInInput, ProfileUpdate } from "@/lib/auth/types";

/**
 * LOCAL DEVELOPMENT ACCOUNT SYSTEM — NOT SECURE PRODUCTION AUTHENTICATION.
 *
 * Everything here lives in this browser's localStorage:
 *  - no server ever sees these credentials
 *  - "password hashing" is a client-side SHA-256 digest with no salt, no
 *    server-side verification, and is trivially readable/bypassable from
 *    devtools — it exists only so a password isn't sitting in plaintext,
 *    not as a real security control
 *  - clearing site data deletes every local account permanently
 *  - there is no password reset, no email verification, nothing
 *
 * This exists to build out the complete account UI (Profile page,
 * create/sign-in flows) ahead of Supabase Auth per the build spec — see
 * Decisions.md "Current backend strategy" and Profile and Accounts.md in
 * the Obsidian vault. Swapping in a real AuthProvider implementation
 * later should not require changing any Profile UI code, only which
 * provider is exported below.
 */

const ACCOUNTS_KEY = "vigil-local-accounts";
const SESSION_KEY = "vigil-local-session";

interface StoredAccount extends AccountProfile {
  passwordHash: string;
}

function readAccounts(): Record<string, StoredAccount> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeAccounts(accounts: Record<string, StoredAccount>) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

async function hashPassword(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toPublicProfile(account: StoredAccount): AccountProfile {
  const { passwordHash: _passwordHash, ...profile } = account;
  return profile;
}

class LocalAuthProvider implements AuthProvider {
  getSession(): AccountProfile | null {
    if (typeof window === "undefined") return null;
    const email = localStorage.getItem(SESSION_KEY);
    if (!email) return null;
    const account = readAccounts()[email.toLowerCase()];
    return account ? toPublicProfile(account) : null;
  }

  async createAccount(input: CreateAccountInput): Promise<AccountProfile> {
    const email = input.email.trim().toLowerCase();
    if (!email || !input.password || !input.displayName.trim()) {
      throw new Error("Email, password, and display name are required.");
    }
    const accounts = readAccounts();
    if (accounts[email]) throw new Error("An account with this email already exists on this device.");

    const account: StoredAccount = {
      id: crypto.randomUUID(),
      email,
      displayName: input.displayName.trim(),
      profilePicture: null,
      createdAt: new Date().toISOString(),
      passwordHash: await hashPassword(input.password),
    };
    accounts[email] = account;
    writeAccounts(accounts);
    localStorage.setItem(SESSION_KEY, email);
    return toPublicProfile(account);
  }

  async signIn(input: SignInInput): Promise<AccountProfile> {
    const email = input.email.trim().toLowerCase();
    const account = readAccounts()[email];
    if (!account || account.passwordHash !== (await hashPassword(input.password))) {
      throw new Error("No matching local account found on this device, or the password is wrong.");
    }
    localStorage.setItem(SESSION_KEY, email);
    return toPublicProfile(account);
  }

  signOut(): void {
    localStorage.removeItem(SESSION_KEY);
  }

  updateProfile(patch: ProfileUpdate): AccountProfile {
    const session = this.getSession();
    if (!session) throw new Error("No signed-in local account to update.");
    const accounts = readAccounts();
    const account = accounts[session.email];
    if (!account) throw new Error("No signed-in local account to update.");
    const updated: StoredAccount = { ...account, ...patch };
    accounts[session.email] = updated;
    writeAccounts(accounts);
    return toPublicProfile(updated);
  }
}

export const authProvider: AuthProvider = new LocalAuthProvider();
