"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { readBasemapState, type BasemapClientState } from "@/lib/map/basemap-state";

interface Diagnostics {
  config: { pmtilesConfigured: boolean; pmtilesUrl: string | null; maptilerKey: string; glyphsUrl: string };
  resolutions: { mode: string; active: { id: string; label: string; kind: string; attribution: string[]; diagnostics: { pmtilesHost?: string; glyphs: string; sprites: string } }; fallback: boolean; reason: string | null; chain: { id: string; usable: boolean; skipped: string | null }[] }[];
  archive: { ok: boolean; status: number | null; rangeSupported: boolean | null; magicOk: boolean; version: number | null; reason: string | null } | null;
  localArchives: string[];
  glyphs: { shippedFonts: string[]; ranges: string };
  sprites: string;
}

/** Basemap diagnostics: configuration, the fallback chain per mode, the archive probe, and what the map did in this browser. */
export default function AdminBasemapPage() {
  const { data, error } = useQuery<Diagnostics>({ queryKey: ["admin", "basemap"], queryFn: async () => (await fetch("/api/admin/basemap")).json() });
  const [client, setClient] = useState<BasemapClientState | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage exists only in the browser
    setClient(readBasemapState());
  }, []);
  return (
    <div className="space-y-5" data-testid="admin-basemap">
      <p className="text-xs text-ink-faint">A basemap carries base geography only. Conflicts, heat, territory, hazards and infrastructure are drawn by Vigil on top of whichever provider is active.</p>
      {error && <p className="text-sm text-red-300">Could not load diagnostics.</p>}
      {data && (
        <>
          <Card className="p-4 text-sm" data-testid="basemap-config">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Configuration</h2>
            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              <dt className="text-ink-faint">PMTiles archive</dt>
              <dd data-testid="cfg-pmtiles">{data.config.pmtilesConfigured ? data.config.pmtilesUrl : "not configured (NEXT_PUBLIC_BASEMAP_PMTILES_URL)"}</dd>
              <dt className="text-ink-faint">MapTiler key</dt>
              <dd data-testid="cfg-maptiler">{data.config.maptilerKey}</dd>
              <dt className="text-ink-faint">Glyphs</dt>
              <dd>{data.config.glyphsUrl}</dd>
              <dt className="text-ink-faint">Shipped fonts</dt>
              <dd>{data.glyphs.shippedFonts.join(", ") || "none"} — {data.glyphs.ranges}</dd>
              <dt className="text-ink-faint">Sprites</dt>
              <dd>{data.sprites}</dd>
              <dt className="text-ink-faint">Local archives (public/basemaps)</dt>
              <dd>{data.localArchives.join(", ") || "none"}</dd>
            </dl>
            {data.archive && (
              <p className={`mt-3 text-xs ${data.archive.ok ? "text-emerald-300" : "text-red-300"}`} data-testid="archive-probe">
                Archive probe: {data.archive.ok ? `OK (PMTiles v${data.archive.version}, Range supported)` : `FAILED — ${data.archive.reason}`}
              </p>
            )}
          </Card>
          <Card className="p-4" data-testid="basemap-resolutions">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Active provider per mode (fallback order)</h2>
            <div className="space-y-3 text-sm">
              {data.resolutions.map((r) => (
                <div key={r.mode} data-testid={`resolution-${r.mode}`}>
                  <p className="font-medium text-ink">
                    {r.mode}: <span data-testid={`active-${r.mode}`}>{r.active.id}</span> — {r.active.label}
                    {r.fallback && <span className="ml-2 text-xs text-yellow-200">fallback</span>}
                  </p>
                  {r.reason && <p className="text-xs text-ink-faint">Reason: {r.reason}</p>}
                  <ul className="mt-1 text-xs text-ink-dim">
                    {r.chain.map((c) => (
                      <li key={c.id}>
                        {c.usable ? "✓" : "✗"} {c.id}
                        {c.skipped ? ` — ${c.skipped}` : ""}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[11px] text-ink-faint">Attribution: {r.active.attribution.join(" · ") || "none"}</p>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
      <Card className="p-4 text-sm" data-testid="basemap-client-state">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">What the map did in this browser</h2>
        {client ? (
          <ul className="space-y-0.5 text-xs text-ink-dim">
            <li>Provider: {client.provider} ({client.mode}){client.fallback ? " — fallback" : ""}</li>
            <li>Map style loaded: {client.mapLoaded ? "yes" : "no"} · recorded {client.at}</li>
            {client.reason && <li>Reason: {client.reason}</li>}
            {Object.keys(client.failed).length > 0 && <li>Failed providers: {Object.entries(client.failed).map(([k, v]) => `${k} (${v})`).join(", ")}</li>}
            <li>
              Glyph ranges: {client.glyphs.local} local · {client.glyphs.remote} remote · {client.glyphs.failed} failed{client.glyphs.lastFailure ? ` (last: ${client.glyphs.lastFailure})` : ""}
            </li>
          </ul>
        ) : (
          <p className="text-xs text-ink-faint">Open /world in this browser first; the map records its state here.</p>
        )}
      </Card>
    </div>
  );
}
