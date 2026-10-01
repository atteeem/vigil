import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { AdminLogoutButton } from "@/components/admin/logout-button";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg pb-16 pt-8">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex shrink-0 items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-accent" />
            <span className="text-sm font-semibold uppercase tracking-wide text-ink-faint">Admin</span>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <AdminLogoutButton />
            <Link href="/world" className="text-xs text-accent hover:underline">
              ← Back to Vigil
            </Link>
          </div>
        </div>
        <nav className="mb-6 flex items-center gap-1.5 overflow-x-auto whitespace-nowrap border-b border-border pb-3">
          <Link
            href="/admin/sources"
            className="rounded-full px-3 py-1.5 text-sm font-medium text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            Source Manager
          </Link>
          <Link
            href="/admin/incoming"
            className="rounded-full px-3 py-1.5 text-sm font-medium text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            Incoming Reports
          </Link>
          <Link
            href="/admin/conflicts"
            className="rounded-full px-3 py-1.5 text-sm font-medium text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            Conflicts
          </Link>
          <Link
            href="/admin/events"
            className="rounded-full px-3 py-1.5 text-sm font-medium text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            Events
          </Link>
          <Link
            href="/admin/territorial-control"
            className="rounded-full px-3 py-1.5 text-sm font-medium text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            Territorial Control
          </Link>
          <Link
            href="/admin/conflict-coverage"
            className="rounded-full px-3 py-1.5 text-sm font-medium text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            Coverage
          </Link>
          <Link
            href="/admin/territorial-changes"
            className="rounded-full px-3 py-1.5 text-sm font-medium text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            Territorial Changes
          </Link>
          <Link
            href="/admin/military"
            className="rounded-full px-3 py-1.5 text-sm font-medium text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            Military Reference
          </Link>
          <Link
            href="/admin/live-data"
            className="rounded-full px-3 py-1.5 text-sm font-medium text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            Live Data
          </Link>
          <Link
            href="/admin/alerts"
            className="rounded-full px-3 py-1.5 text-sm font-medium text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            Alerts
          </Link>
          <Link
            href="/admin/briefings"
            className="rounded-full px-3 py-1.5 text-sm font-medium text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            Briefings
          </Link>
          <Link
            href="/admin/basemap"
            className="rounded-full px-3 py-1.5 text-sm font-medium text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            Basemap
          </Link>
        </nav>
        {children}
      </div>
    </div>
  );
}
