"use client";

import { useRef, useState } from "react";
import {
  UserRound,
  Lock,
  Bell,
  RefreshCw,
  Laptop2,
  LogIn,
  UserPlus,
  LogOut,
  Pencil,
  Camera,
  ShieldAlert,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { CountrySelector } from "@/components/home/country-selector";
import { useAppStore } from "@/hooks/use-app-store";
import { useAuthSession } from "@/hooks/use-auth-session";
import { authProvider } from "@/lib/auth/local-auth-provider";
import { isAcceptedImageType, resizeImageToDataUrl } from "@/lib/utils/image";
import { MAP_BASEMAP_MODES, MAP_BASEMAP_MODE_LABEL } from "@/lib/map/style";
import { REGIONS, TIME_RANGES } from "@/lib/types";
import type { Region, TimeRange } from "@/lib/types";
import { cn } from "@/lib/utils";

const TIMEZONES: { value: string; label: string }[] = [
  { value: "auto", label: "Auto (use my device)" },
  { value: "UTC", label: "UTC" },
  { value: "Europe/Helsinki", label: "Helsinki (EET/EEST)" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Berlin", label: "Berlin (CET/CEST)" },
  { value: "Europe/Moscow", label: "Moscow (MSK)" },
  { value: "Asia/Jerusalem", label: "Jerusalem (IST)" },
  { value: "Asia/Dubai", label: "Dubai (GST)" },
  { value: "Asia/Kolkata", label: "Mumbai/Delhi (IST)" },
  { value: "Asia/Shanghai", label: "Beijing/Shanghai (CST)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" },
  { value: "Asia/Singapore", label: "Singapore (SGT)" },
  { value: "America/New_York", label: "New York (ET)" },
  { value: "America/Chicago", label: "Chicago (CT)" },
  { value: "America/Los_Angeles", label: "Los Angeles (PT)" },
  { value: "Africa/Cairo", label: "Cairo (EET)" },
  { value: "Africa/Johannesburg", label: "Johannesburg (SAST)" },
  { value: "Australia/Sydney", label: "Sydney (AEST/AEDT)" },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0]![0]! + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default function ProfilePage() {
  const account = useAuthSession();
  const setAccount = useAppStore((s) => s.setAccount);

  const timezone = useAppStore((s) => s.timezone);
  const setTimezone = useAppStore((s) => s.setTimezone);
  const preferredRegions = useAppStore((s) => s.preferredRegions);
  const setPreferredRegions = useAppStore((s) => s.setPreferredRegions);
  const globeViewMode = useAppStore((s) => s.globeViewMode);
  const setGlobeViewMode = useAppStore((s) => s.setGlobeViewMode);
  const mapBasemapMode = useAppStore((s) => s.mapBasemapMode);
  const setMapBasemapMode = useAppStore((s) => s.setMapBasemapMode);
  const timeRange = useAppStore((s) => s.timeRange);
  const setTimeRange = useAppStore((s) => s.setTimeRange);
  const contentSensitivity = useAppStore((s) => s.contentSensitivity);
  const setContentSensitivity = useAppStore((s) => s.setContentSensitivity);

  function toggleRegion(region: Region) {
    setPreferredRegions(
      preferredRegions.includes(region)
        ? preferredRegions.filter((r) => r !== region)
        : [...preferredRegions, region],
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-28 pt-24 sm:px-6 sm:pt-32">
      {account ? <AuthenticatedHeader account={account} onSignOut={() => setAccount(null)} /> : <LoggedOutHeader onAuthed={setAccount} />}

      <div className="mt-6 space-y-4">
        <Card className="p-5">
          <SectionLabel>Home country</SectionLabel>
          <p className="mb-3 text-xs text-ink-faint">
            Used to compute your personalized Impact Score across the app.
          </p>
          <CountrySelector />
        </Card>

        <Card className="p-5">
          <SectionLabel>Timezone</SectionLabel>
          <p className="mb-3 text-xs text-ink-faint">
            Controls how absolute timestamps (event times, source publish
            times) are displayed. Relative times (&quot;3 min ago&quot;) are unaffected.
          </p>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full rounded-xl border border-border-strong bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </Card>

        <Card className="p-5">
          <SectionLabel>Preferred regions</SectionLabel>
          <p className="mb-3 text-xs text-ink-faint">
            Regions you follow most closely. Every region stays visible
            everywhere — this only highlights your picks.
          </p>
          <div className="flex flex-wrap gap-2">
            {REGIONS.map((region) => {
              const active = preferredRegions.includes(region);
              return (
                <button
                  key={region}
                  onClick={() => toggleRegion(region)}
                  aria-pressed={active}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "border-accent/40 bg-accent-dim text-accent"
                      : "border-border-strong text-ink-dim hover:text-ink",
                  )}
                >
                  {region}
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="p-5">
          <SectionLabel>Default globe view</SectionLabel>
          <p className="mb-3 text-xs text-ink-faint">
            Which homepage globe style loads by default. You can always
            switch instantly from the globe itself.
          </p>
          <SegmentedControl
            aria-label="Default globe view"
            options={[
              { value: "intel", label: "Intel" },
              { value: "satellite", label: "Satellite" },
            ]}
            value={globeViewMode}
            onChange={setGlobeViewMode}
          />
        </Card>

        <Card className="p-5">
          <SectionLabel>Default map mode</SectionLabel>
          <p className="mb-3 text-xs text-ink-faint">
            Which basemap the Live Map (<code>/world</code>) opens in by default.
          </p>
          <SegmentedControl
            aria-label="Default map mode"
            options={MAP_BASEMAP_MODES.map((m) => ({ value: m, label: MAP_BASEMAP_MODE_LABEL[m] }))}
            value={mapBasemapMode}
            onChange={setMapBasemapMode}
          />
        </Card>

        <Card className="p-5">
          <SectionLabel>Default time range</SectionLabel>
          <p className="mb-3 text-xs text-ink-faint">
            The time window selected by default on the homepage and
            operational map.
          </p>
          <SegmentedControl
            aria-label="Default time range"
            options={TIME_RANGES.map((t: TimeRange) => ({ value: t, label: t }))}
            value={timeRange}
            onChange={setTimeRange}
          />
        </Card>

        <Card className="p-5">
          <SectionLabel>Content sensitivity</SectionLabel>
          <p className="mb-3 text-xs text-ink-faint">
            &quot;Reduced&quot; keeps the same information but calms high-severity
            visual emphasis (e.g. pulsing globe hotspots).
          </p>
          <SegmentedControl
            aria-label="Content sensitivity"
            options={[
              { value: "standard", label: "Standard" },
              { value: "reduced", label: "Reduced" },
            ]}
            value={contentSensitivity}
            onChange={setContentSensitivity}
          />
        </Card>

        <Card className="p-5">
          <SectionLabel>Theme</SectionLabel>
          <p className="mb-3 text-xs text-ink-faint">
            Vigil is dark-mode only for Phase 1. More themes are planned.
          </p>
          <SegmentedControl
            aria-label="Theme"
            options={[{ value: "dark", label: "Dark (default)" }]}
            value="dark"
            onChange={() => {}}
          />
        </Card>

        <Card className="p-5">
          <SectionLabel>Requires a synced account (coming later)</SectionLabel>
          <p className="mb-3 text-xs text-ink-faint">
            {account
              ? "Your local account keeps these preferences on this device only. A real synced account (Supabase Auth, a later phase) will follow you anywhere."
              : "These preferences are saved to this browser only. Creating a local account above doesn't change that yet — a real synced account (a later phase) will."}
          </p>
          <ul className="space-y-2.5">
            <FutureFeature
              icon={RefreshCw}
              label="Synced watchlists"
              description="Save conflicts and countries to a list that follows your account."
            />
            <FutureFeature
              icon={Laptop2}
              label="Multi-device preferences"
              description="These settings currently live only in this browser, not a synced account."
            />
            <FutureFeature
              icon={Bell}
              label="Alerts & notifications"
              description="Push or email alerts when a followed conflict or country changes materially."
            />
          </ul>
        </Card>
      </div>
    </main>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
      {children}
    </p>
  );
}

function FutureFeature({
  icon: Icon,
  label,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-border bg-surface/50 p-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border-strong text-ink-faint">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-ink">{label}</p>
          <span className="flex items-center gap-1 rounded-full border border-border-strong px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">
            <Lock className="h-2.5 w-2.5" /> Needs account
          </span>
        </div>
        <p className="mt-0.5 text-xs text-ink-faint">{description}</p>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------
// Logged-out: header + Create Account / Sign In
// ---------------------------------------------------------------------

type AccountLike = ReturnType<typeof authProvider.getSession>;

function LoggedOutHeader({ onAuthed }: { onAuthed: (a: AccountLike) => void }) {
  const [mode, setMode] = useState<"none" | "create" | "signin">("none");

  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border-strong bg-surface">
          <UserRound className="h-6 w-6 text-ink-faint" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-ink">Vigil Profile</h1>
          <p className="text-sm text-ink-dim">Preferences are currently stored on this device.</p>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <Button variant="primary" size="sm" onClick={() => setMode(mode === "create" ? "none" : "create")}>
          <UserPlus className="h-3.5 w-3.5" /> Create Account
        </Button>
        <Button variant="outline" size="sm" onClick={() => setMode(mode === "signin" ? "none" : "signin")}>
          <LogIn className="h-3.5 w-3.5" /> Sign In
        </Button>
      </div>

      {mode === "create" && <CreateAccountForm onAuthed={onAuthed} onClose={() => setMode("none")} />}
      {mode === "signin" && <SignInForm onAuthed={onAuthed} onClose={() => setMode("none")} />}
    </div>
  );
}

function LocalDevNotice() {
  return (
    <p className="mb-3 flex items-start gap-1.5 rounded-lg border border-border bg-surface/50 p-2.5 text-[11px] text-ink-faint">
      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      Local-development account: stored only in this browser, not secure production authentication. Clearing site
      data deletes it permanently.
    </p>
  );
}

function CreateAccountForm({ onAuthed, onClose }: { onAuthed: (a: AccountLike) => void; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      const account = await authProvider.createAccount({ email, password, displayName });
      onAuthed(account);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-3 p-4">
      <LocalDevNotice />
      <div className="space-y-2.5">
        <input
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
          placeholder="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <input
          type="email"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <input
          type="password"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
          placeholder="Confirm password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error && <p className="text-xs text-high">{error}</p>}
        <Button variant="primary" size="sm" onClick={submit} disabled={busy}>
          {busy ? "Creating…" : "Create Account"}
        </Button>
      </div>
    </Card>
  );
}

function SignInForm({ onAuthed, onClose }: { onAuthed: (a: AccountLike) => void; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const account = await authProvider.signIn({ email, password });
      onAuthed(account);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-3 p-4">
      <LocalDevNotice />
      <div className="space-y-2.5">
        <input
          type="email"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-xs text-high">{error}</p>}
        <Button variant="primary" size="sm" onClick={submit} disabled={busy}>
          {busy ? "Signing in…" : "Sign In"}
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Authenticated header + Edit Profile
// ---------------------------------------------------------------------

function AuthenticatedHeader({
  account,
  onSignOut,
}: {
  account: NonNullable<AccountLike>;
  onSignOut: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const setAccount = useAppStore((s) => s.setAccount);

  function handleSignOut() {
    authProvider.signOut();
    onSignOut();
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <Avatar name={account.displayName} picture={account.profilePicture} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold text-ink">{account.displayName}</h1>
          <p className="truncate text-sm text-ink-dim">{account.email}</p>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>
          <Pencil className="h-3.5 w-3.5" /> {editing ? "Close" : "Edit Profile"}
        </Button>
        <Button variant="ghost" size="sm" onClick={handleSignOut}>
          <LogOut className="h-3.5 w-3.5" /> Sign Out
        </Button>
      </div>
      {editing && (
        <EditProfileForm
          account={account}
          onSaved={(updated) => {
            setAccount(updated);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

function Avatar({ name, picture, size = 48 }: { name: string; picture: string | null; size?: number }) {
  if (picture) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- local-dev data URI, not an optimizable remote/static asset
      <img
        src={picture}
        alt={name}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full border border-border-strong object-cover"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface text-sm font-semibold text-ink-faint"
    >
      {initials(name)}
    </div>
  );
}

function EditProfileForm({
  account,
  onSaved,
}: {
  account: NonNullable<AccountLike>;
  onSaved: (a: AccountLike) => void;
}) {
  const [displayName, setDisplayName] = useState(account.displayName);
  const [picture, setPicture] = useState(account.profilePicture);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    if (!isAcceptedImageType(file)) {
      setError("Please choose a JPEG, PNG, or WebP image.");
      return;
    }
    try {
      setPicture(await resizeImageToDataUrl(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not process that image.");
    }
  }

  function save() {
    const updated = authProvider.updateProfile({ displayName: displayName.trim() || account.displayName, profilePicture: picture });
    onSaved(updated);
  }

  return (
    <Card className="mt-3 p-4">
      <div className="flex items-center gap-3">
        <Avatar name={displayName} picture={picture} size={56} />
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            <Camera className="h-3.5 w-3.5" /> Change picture
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>
      </div>
      <div className="mt-3 space-y-2.5">
        <label className="block text-xs text-ink-faint">
          Display name
          <input
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
        <p className="text-[11px] text-ink-faint">
          Home country, timezone, preferred regions, default map, default time range, and content sensitivity are
          edited directly in the cards below.
        </p>
        {error && <p className="text-xs text-high">{error}</p>}
        <Button size="sm" variant="primary" onClick={save}>
          Save Changes
        </Button>
      </div>
    </Card>
  );
}
