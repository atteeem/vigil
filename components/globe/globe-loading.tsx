export function GlobeLoading() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-bg">
      <div className="relative h-40 w-40">
        <div className="absolute inset-0 rounded-full border border-border-strong" />
        <div className="absolute inset-4 rounded-full border border-border" />
        <div className="absolute inset-8 rounded-full border border-border" />
        <div className="absolute inset-0 animate-spin rounded-full border-t-2 border-accent" style={{ animationDuration: "2.4s" }} />
      </div>
      <p className="text-xs font-medium uppercase tracking-widest text-ink-faint">
        Initializing global view
      </p>
    </div>
  );
}

export function GlobeUnavailable() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
      <div className="h-16 w-16 rounded-full border border-border-strong" />
      <p className="text-sm font-medium text-ink-dim">
        3D globe view isn&apos;t available in this browser.
      </p>
      <p className="max-w-xs text-xs text-ink-faint">
        Your device or browser may not support WebGL. Try the operational map
        instead.
      </p>
    </div>
  );
}
