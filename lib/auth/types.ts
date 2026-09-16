// Account/auth abstraction. The active implementation is
// local-auth-provider.ts (localStorage, no server) — see its file header
// for why it is explicitly NOT secure production authentication. This
// interface is what a Supabase Auth implementation would satisfy later,
// so Profile UI code depends on AuthProvider, never on localStorage or
// Supabase specifics directly (Decisions.md "Current backend strategy").

export interface AccountProfile {
  id: string;
  email: string;
  displayName: string;
  /** Small data URI (resized client-side) or null for the initials fallback. */
  profilePicture: string | null;
  createdAt: string;
}

export interface CreateAccountInput {
  email: string;
  password: string;
  displayName: string;
}

export interface SignInInput {
  email: string;
  password: string;
}

export type ProfileUpdate = Partial<Pick<AccountProfile, "displayName" | "profilePicture">>;

export interface AuthProvider {
  getSession(): AccountProfile | null;
  createAccount(input: CreateAccountInput): Promise<AccountProfile>;
  signIn(input: SignInInput): Promise<AccountProfile>;
  signOut(): void;
  updateProfile(patch: ProfileUpdate): AccountProfile;
}
