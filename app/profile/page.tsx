"use client";

import { UserRound, Lock, Bell, RefreshCw, Laptop2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { CountrySelector } from "@/components/home/country-selector";
import { useAppStore } from "@/hooks/use-app-store";
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

export default function ProfilePage() {
  const timezone = useAppStore((s) => s.timezone);
  const setTimezone = useAppStore((s) => s.setTimezone);
  const preferredRegions = useAppStore((s) => s.preferredRegions);
  const setPreferredRegions = useAppStore((s) => s.setPreferredRegions);
  const globeViewMode = useAppStore((s) => s.globeViewMode);
  const setGlobeViewMode = useAppStore((s) => s.setGlobeViewMode);
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
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border-strong bg-surface">
          <UserRound className="h-6 w-6 text-ink-faint" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-ink">Preferences</h1>
          <p className="text-sm text-ink-dim">
            No account needed yet — these are saved to this browser.
          </p>
        </div>
      </div>

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
          <SectionLabel>Requires an account (coming later)</SectionLabel>
          <p className="mb-3 text-xs text-ink-faint">
            These preferences are saved to this browser only. Signing in
            (a later phase) will let them follow you anywhere.
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
              description="These settings currently live only in this browser, not your account."
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
