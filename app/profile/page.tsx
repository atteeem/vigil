"use client";

import { useRef, useState } from "react";
import {
  UserRound,
  ArrowRight,
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
import { TIME_RANGES } from "@/lib/types";
import type { TimeRange } from "@/lib/types";
import Link from "next/link";
import { SourceTrustList } from "@/components/sources/source-trust-help";
import { IMPACT_COUNTRY_COPY, SCORE_COPY } from "@/lib/copy/scores";
import { clearRecent } from "@/lib/discovery/recent";
import { replayIntroduction } from "@/lib/discovery/onboarding";
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
  const globeViewMode = useAppStore((s) => s.globeViewMode);
  const setGlobeViewMode = useAppStore((s) => s.setGlobeViewMode);
  const mapBasemapMode = useAppStore((s) => s.mapBasemapMode);
  const setMapBasemapMode = useAppStore((s) => s.setMapBasemapMode);
  const timeRange = useAppStore((s) => s.timeRange);
  const setTimeRange = useAppStore((s) => s.setTimeRange);
  const contentSensitivity = useAppStore((s) => s.contentSensitivity);
  const setContentSensitivity = useAppStore((s) => s.setContentSensitivity);
  const showPartyClaims = useAppStore((s) => s.showPartyClaims);
  const setShowPartyClaims = useAppStore((s) => s.setShowPartyClaims);

  const [cleared, setCleared] = useState(false);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-28 pt-24 sm:px-6 sm:pt-32">
      {account ? <AuthenticatedHeader account={account} onSignOut={() => setAccount(null)} /> : <LoggedOutHeader onAuthed={setAccount} />}

      <nav aria-label="Settings sections" className="no-scrollbar mt-6 flex gap-1.5 overflow-x-auto" data-testid="settings-nav">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs text-ink-dim hover:text-ink">
            {label}
          </a>
        ))}
      </nav>

      <div className="mt-4 space-y-4">
        <Card className="scroll-mt-24 p-5" id="general" data-testid="settings-general">
          <SectionTitle>General</SectionTitle>
          <SectionLabel>Timezone</SectionLabel>
          <p className="mb-3 text-xs text-ink-faint">
            Controls how absolute timestamps (event times, source publish times) are displayed. Relative times (&quot;3 min ago&quot;) are unaffected.
          </p>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            aria-label="Timezone"
            className="w-full rounded-xl border border-border-strong bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
          <div className="mt-5">
            <SectionLabel>Reduced motion</SectionLabel>
            <label className="flex items-start gap-2 text-sm text-ink" htmlFor="reduced-motion">
              <input
                id="reduced-motion"
                type="checkbox"
                checked={contentSensitivity === "reduced"}
                onChange={(e) => setContentSensitivity(e.target.checked ? "reduced" : "standard")}
                className="mt-0.5 h-4 w-4 rounded border-border-strong accent-accent"
                data-testid="reduced-motion"
              />
              <span>
                Reduce motion
                <span className="block text-xs text-ink-faint">No pulsing hotspots, and the map jumps instead of flying (Live View included). Your device&apos;s reduced-motion setting is always respected too.</span>
              </span>
            </label>
          </div>
        </Card>

        <Card className="scroll-mt-24 p-5" id="impact-country" data-testid="settings-impact-country">
          <SectionTitle>Impact country</SectionTitle>
          <p className="mb-3 text-xs text-ink-faint">{IMPACT_COUNTRY_COPY.explain}</p>
          <CountrySelector />
        </Card>

        <Card className="scroll-mt-24 p-5" id="sources" data-testid="sources-settings">
          <SectionTitle>Sources</SectionTitle>
          <p className="mb-3 text-xs text-ink-faint">
            Party and aligned claims are statements by a side in a conflict (a military, a state outlet, an aligned channel). They are hidden from event source lists by default and are never counted as independent
            confirmation. Turning this on shows them separately, labelled PARTY CLAIM. They stay stored either way.
          </p>
          <label className="flex items-center gap-2 text-sm text-ink" htmlFor="show-party-claims">
            <input
              id="show-party-claims"
              type="checkbox"
              checked={showPartyClaims}
              onChange={(e) => setShowPartyClaims(e.target.checked)}
              className="h-4 w-4 rounded border-border-strong accent-accent"
              data-testid="show-party-claims"
            />
            Show Party / Aligned Claims
          </label>
          <div className="mt-4 border-t border-border pt-4">
            <SectionLabel>Source labels</SectionLabel>
            <SourceTrustList />
          </div>
        </Card>

        <Card className="scroll-mt-24 p-5" id="notifications" data-testid="settings-notifications">
          <SectionTitle>Notifications</SectionTitle>
          <p className="text-xs text-ink-faint">
            In-app notifications (the bell in the header) come from what you watch. Choose what to watch, and how much each watch alerts you, on the Watchlist. There are no email or push notifications.
          </p>
          <Link href="/watchlist" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
            Manage watches and alert levels <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </Card>

        <Card className="scroll-mt-24 p-5" id="map" data-testid="settings-map">
          <SectionTitle>Map</SectionTitle>
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
          <div className="mt-5">
            <SectionLabel>Default globe view</SectionLabel>
            <p className="mb-3 text-xs text-ink-faint">Which Overview globe style loads by default. You can always switch from the globe itself.</p>
            <SegmentedControl
              aria-label="Default globe view"
              options={[
                { value: "intel", label: "Intel" },
                { value: "satellite", label: "Satellite" },
              ]}
              value={globeViewMode}
              onChange={setGlobeViewMode}
            />
          </div>
          <div className="mt-5">
            <SectionLabel>Default Overview time range</SectionLabel>
            <p className="mb-3 text-xs text-ink-faint">The time window the Overview globe opens with.</p>
            <SegmentedControl
              aria-label="Default time range"
              options={TIME_RANGES.map((t: TimeRange) => ({ value: t, label: t }))}
              value={timeRange}
              onChange={setTimeRange}
            />
          </div>
        </Card>

        <Card className="scroll-mt-24 p-5" id="privacy" data-testid="settings-privacy">
          <SectionTitle>Privacy / local data</SectionTitle>
          <p className="text-xs text-ink-faint">
            Vigil needs no account and never asks for your location. Your settings, recent searches and introduction progress are stored in this browser only. Watches are stored on the server under a random
            identifier for this browser, not your name.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { clearRecent(); setCleared(true); }} data-testid="clear-recent-searches">
              Clear recent searches
            </Button>
            {cleared && <span className="text-xs text-ink-faint" role="status">Recent searches cleared.</span>}
          </div>
        </Card>

        <Card className="scroll-mt-24 p-5" id="help" data-testid="settings-help">
          <SectionTitle>Help / About</SectionTitle>
          <div className="flex flex-col items-start gap-2">
            <Button variant="outline" size="sm" onClick={() => { replayIntroduction(); window.scrollTo({ top: 0 }); }} data-testid="show-introduction">
              Show introduction again
            </Button>
            <Link href="/methodology" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline" data-testid="settings-methodology">
              Methodology: how Vigil scores and sources <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
          <dl className="mt-4 space-y-1.5 text-xs">
            {(["severity", "impact", "confidence"] as const).map((k) => (
              <div key={k}>
                <dt className="inline font-semibold text-ink">{SCORE_COPY[k].label}: </dt>
                <dd className="inline text-ink-dim">{SCORE_COPY[k].question}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </main>
  );
}

const SECTIONS = [
  ["general", "General"],
  ["impact-country", "Impact country"],
  ["sources", "Sources"],
  ["notifications", "Notifications"],
  ["map", "Map"],
  ["privacy", "Privacy"],
  ["help", "Help"],
] as const;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-base font-semibold text-ink">{children}</h2>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
      {children}
    </p>
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
          <h1 className="text-xl font-semibold text-ink">Settings</h1>
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
