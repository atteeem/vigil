import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg pb-16 pt-8">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-accent" />
            <span className="text-sm font-semibold uppercase tracking-wide text-ink-faint">Admin</span>
          </div>
          <Link href="/world" className="text-xs text-accent hover:underline">
            ← Back to Vigil
          </Link>
        </div>
        <nav className="mb-6 flex items-center gap-1.5 border-b border-border pb-3">
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
        </nav>
        {children}
      </div>
    </div>
  );
}
