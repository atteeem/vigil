# DESIGN_SYSTEM.md — Vigil

Premium geopolitical intelligence aesthetic: Bloomberg Terminal × FlightRadar24
× Apple × modern defense/intelligence software. Serious, elegant, dark,
technical, trustworthy, data-rich, cinematic without being theatrical. Not a
gaming site, not crypto-dashboard neon, not a generic SaaS template.

## Color tokens

Defined as CSS variables in `app/globals.css`, mapped into Tailwind via
`tailwind.config.ts`. Dark is the only theme in Phase 1.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#080A0D` | App background |
| `--surface` | `#0E1116` | Elevated surface (panels, sheets) |
| `--card` | `#12161C` | Cards |
| `--border` | `rgba(255,255,255,0.08)` | Hairline borders |
| `--text-primary` | `#F3F5F7` | Primary text |
| `--text-secondary` | `#8D96A5` | Secondary text |
| `--text-muted` | `#5E6672` | Muted / caption text |
| `--accent` | `#4CC2FF` | Neutral interface accent (cyan/blue), restrained use |
| `--sev-stable` | `#3DDC84` | Severity: Stable |
| `--sev-guarded` | `#8FC93A` | Severity: Guarded |
| `--sev-elevated` | `#E4C441` | Severity: Elevated |
| `--sev-high` | `#F0923B` | Severity: High |
| `--sev-severe` | `#EF4B4B` | Severity: Severe |
| `--sev-extreme` | `#80152A` | Severity: Extreme (deep blood/wine-red, not neon) |
| `--sev-extreme-base` | `#5A0B18` | Extreme: darker base tone (card fills, dim backgrounds) |
| `--sev-extreme-accent` | `#80152A` | Extreme: brighter accent/halo (dots, pulse, borders) |

Rules: no pure black, no rainbow gradients, glow is reserved for the
severity dot/pulse only (never whole-card glow). Generous negative space.
Translucent surfaces (`bg-surface/70` + backdrop-blur) where a panel floats
over the globe.

## Severity & risk color system (Phase 1.5 — single source of truth)

**One centralized system** drives every severity color/label in the app:
`lib/utils/severity.ts` exports `severityFromScore()`, `SEVERITY_HEX`,
`SEVERITY_LABEL`, and Tailwind-class helpers. No component defines its own
severity color map — globe hotspots, `/world` map hotspots (MapLibre
`circle-color`), score indicators, cards, charts, and severity badges all
import from this one file. `app/globals.css`'s `--sev-*`/`--color-*`
variables are kept in sync with `SEVERITY_HEX` by convention (see the
comment in both files); if one changes, the other must too.

Six-step scale, always paired with a number and/or text label — never
color alone:

| Score | Label | Hex |
|---|---|---|
| 0–29 | Stable | `#3DDC84` |
| 30–49 | Guarded | `#8FC93A` |
| 50–69 | Elevated | `#E4C441` |
| 70–79 | High | `#F0923B` |
| 80–89 | Severe | `#EF4B4B` |
| 90–100 | Extreme | `#80152A` (base `#5A0B18`) |

`severityFromScore()` derives severity **directly from the same
intensity/score number** shown alongside it, at data-construction time (see
"Severity vs. Intensity" below) — this is what makes contradictory pairs
(e.g. a lower-intensity conflict showing a higher severity label than a
higher-intensity one) structurally impossible rather than something to
catch by review.

Extreme (90–100) intentionally breaks from the smooth stable→severe hue
ramp: instead of continuing toward orange/bright-red, it drops to a deep
blood/wine tone (base `#5A0B18`, accent/halo `#80152A`) specifically so the
worst tier reads as *dangerous and somber*, not as a brighter, more
"exciting" color than Severe — deliberately avoiding neon or game-UI
associations. Extreme is the one tier allowed a (capped-rate, opacity/scale
only, `prefers-reduced-motion`-respecting) halo pulse on the globe; this
pulse is suppressed entirely when the user's Content Sensitivity preference
is set to "Reduced" (see Profile below).

Coloring a whole country as Extreme is only correct when the underlying
score genuinely represents the whole country (e.g. a national conflict
index) — never applied as a blanket visual treatment for a country that
merely contains an Extreme-scored conflict in one region.

Verification statuses (events) are a separate vocabulary, never merged with
severity, and are **derived from source count, never authored
independently** (see "Source & verification consistency" below):
`Unverified → Reported → Official Claim → Multiple Sources → Confirmed`
plus the flag `Disputed` which can attach to any of the above.

### Severity vs. Intensity

`Intensity` (0–100) measures how active a conflict currently is; `Severity`
is that same number's label under the centralized thresholds above — they
are two views of one figure, never independently authored, so a lower
Intensity can never carry a higher Severity label than a higher one. See
`lib/data/mock-conflicts.ts`: each conflict's `severity` field is computed
as `severityFromScore(intensity)`, not hand-set.

### Source & verification consistency

`VerificationStatus` is derived **from** `sourceCount`, never the reverse,
and multiple sources are never automatically treated as `Confirmed`:

- 1 source → `Reported` (weighted majority) / `Official Claim` /
  `Unverified`.
- 2+ independent sources → `Multiple Sources` (weighted majority) /
  `Confirmed` (still the minority outcome even with several sources — real
  independent confirmation is presented as the exception, not the norm).

This makes the old failure mode ("Multiple Sources" shown next to "1
source") structurally impossible, since the display state is derived from
the same source-count record rather than randomized separately. See
`lib/data/mock-events.ts`'s `SINGLE_SOURCE_WEIGHTS` /
`MULTI_SOURCE_WEIGHTS` / `SOURCE_COUNT_WEIGHTS`.

## Typography

Modern sans-serif (`Inter`, variable font, self-hosted via `next/font`).
Numeric figures use tabular/lining figures for alignment in score displays.

| Style | Size / weight | Use |
|---|---|---|
| Display | 40–56px / 600 | Hero score (Global Status, Impact Score) |
| H1 | 28–32px / 600 | Page headers |
| H2 | 20–22px / 600 | Section headers |
| Body | 15px / 400 | Default copy |
| Small | 13px / 500 | Labels, badges, meta |
| Micro | 11px / 600, uppercase, tracked | Eyebrow labels ("SEVERITY", "LIVE") |

## Spacing & shape

- Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64px.
- Card corner radius: 16px (14–18px range per spec).
- Border: 1px `--border`, no heavy drop shadows — at most a soft
  `0 8px 24px rgba(0,0,0,0.35)` on floating panels.
- Max content width on data pages: 1280px, with the globe/map allowed to go
  full-bleed.

## Components

- **Cards**: `bg-card/90 backdrop-blur border border-[--border] rounded-2xl
  p-5`. Floating cards over the globe use `bg-surface/70 backdrop-blur-xl`.
- **Buttons**: primary = accent-tinted outline, filled only for the single
  most important action per view (e.g. "View Conflict"); secondary = ghost.
  No large filled gradient buttons.
- **Badges**: severity badge = dot + label, pill shape, background tinted at
  12% opacity of the severity color; verification badge = outline pill,
  neutral color, icon + label.
- **Segmented controls**: time range (1H/6H/24H/7D/30D) and layer toggle
  (Events/Conflicts/Energy/Trade) share one control style — pill group,
  active state = filled `--surface` with `--text-primary`, inactive =
  transparent with `--text-secondary`.
- **Icons**: Lucide only, 16–20px, stroke width 1.75, paired with a text
  label wherever meaning-bearing (never icon-only for severity).

## Motion (Framer Motion)

Allowed: globe auto-rotation, marker pulse (opacity/scale, capped rate),
panel/bottom-sheet enter-exit, number count-up on score changes, chart line
draw-in, button hover/press micro-states. Disallowed: constant glow
breathing on cards, particle effects, floating/parallax chrome, springy
overshoot. Everything respects `prefers-reduced-motion` (motion drops to
simple opacity fades).

## Responsive principles

- **Mobile (320–767px)**: single column, globe ~55–65vh, floating cards
  become stacked full-width cards below the globe fold, bottom-sheet pattern
  for detail views, bottom tab bar (5 items), thumb-reachable primary
  actions.
- **Tablet (768–1023px)**: two-column where the desktop has three; nav
  becomes icon+label top bar; globe stays hero but shorter.
- **Desktop (1024–1439px)**: full nav, floating left/right cards over the
  globe, three-column `/world` layout.
- **Large desktop (1440px+)**: content max-width caps, extra breathing room,
  no stretching of card grids beyond a comfortable column count.

## Globe view modes (Phase 1.5)

The homepage globe has two view modes, switched via a compact
`role="radio"` segmented control (`GlobeControls`) placed directly on the
globe overlay — Intel and Satellite share one small control cluster with a
Layers popover, deliberately kept tiny per spec ("keep the UI extremely
compact"):

- **Intel** (default): the original stylized dark geopolitical globe —
  flat-shaded landmass polygons, accent-colored coastline stroke, hotspots.
- **Satellite**: realistic natural Earth imagery via `react-globe.gl`'s
  existing `globeImageUrl`/`bumpImageUrl` texture props — **no globe
  library was replaced or added**; `react-globe.gl`/`three-globe` already
  supported texture-based imagery, so this was the least-destructive
  compatible method available. The landmass polygon fill is switched off
  in this mode (the photographic texture already shows land) while
  hotspots, borders, and labels continue to render identically in both
  modes.

Four independent, togglable globe layers (`GlobeLayerVisibility`):
**Conflicts** (on by default), **Events**, **Borders**, **Labels** — all
off-by-default except Conflicts, so first paint never pays for anything
optional. Switching view mode or toggling a layer **never resets camera
position/zoom**: the camera `useEffect` in `conflict-globe.tsx`
deliberately excludes `viewMode`/`globeLayers` from its dependency array
(see the comment there) so `pointOfView` is only ever set on mount or on
an explicit conflict-focus action.

**Imagery/geometry licensing**: Satellite mode's texture
(`earth-blue-marble.jpg`, `earth-topology.png`) and the Borders/Labels
layer's vector data (`country-borders.json`, Natural Earth 1:110m admin-0
countries) are both public domain (NASA "Blue Marble" / Natural Earth) and
are self-hosted, static-served copies of assets already bundled as example
data inside the project's own `three-globe` npm dependency — not fetched
from, or derived from, Google Earth or any other third-party mapping
product.

**Performance**: Borders/Labels pull in a real ~490KB Natural Earth
dataset, so it's lazy-loaded via dynamic `import()` only when one of those
two layers is actually switched on — Intel-only sessions, and every first
paint, never pay for it. `getCountryBorderPaths()` further keeps only the
single largest ring per country (a landmass-size proxy) rather than every
ring (289 → 177), and the `<Globe>` `pathResolution` prop is raised to
reduce great-circle interpolation density; `pathStroke` is deliberately
left unset so three-globe uses its plain `THREE.Line` renderer rather than
its heavier per-path `Line2`/`LineMaterial` "fat line" path. Measured
directly (bypassing Playwright's own actionability-check overhead against
an actively-rotating canvas, which is misleading here): the one-time
dynamic-import fetch/parse is ~1.1s (paid once per session, only if a user
opts in), and the actual toggle-to-painted-frame cost after that is
~550–600ms under this sandbox's *software-rendered* (swiftshader) WebGL —
expected to be substantially faster on real GPU hardware, mobile included.
Events uses `pointsData`/`pointsMerge` (three-globe's batched/merged point
layer, cheap regardless of count) and is additionally capped at 25 points
on mobile / 70 on desktop.

## Profile / Preferences (Phase 1.5)

`/profile` is a fully functional, accountless Preferences page — not a
stub. It reads/writes a `persist`-backed Zustand store (`vigil-preferences`
in `localStorage`) covering: Home country, Timezone (drives
`formatAbsoluteTime()` everywhere an absolute timestamp is shown), Preferred
regions, Default globe view (Intel/Satellite), Default time range, Content
sensitivity (Standard/Reduced — Reduced suppresses the Extreme pulse
animation), and Theme (dark-only in Phase 1, shown disabled with
explanatory copy rather than hidden). A clearly separated "Requires an
account (coming later)" section lists the three features that genuinely
need auth — synced watchlists, multi-device preferences, alerts &
notifications — each with a "Needs account" lock badge, so nothing implies
a login that doesn't exist yet.

## Navigation (Phase 1.5)

Desktop primary nav: **Overview** (`/`, the 3D globe homepage) · **Live
Map** (`/world`, the operational map — previously under-exposed, now a
first-class nav item) · **For You** · **Conflicts** · **Markets**, with
Profile/search/alerts at the right. Mobile bottom tab bar: **World** (`/`)
· **Map** (`/world`) · **For You** · **Conflicts** · **Markets** — Profile
moved to the mobile top bar (now rendered globally in the root layout, not
homepage-only) since the 5-slot bottom bar has no room for a 6th item.
Intel briefings (`/intel`) were intentionally dropped from the primary nav
per spec but stay reachable via contextual "Regional Intel Briefings" links
on the homepage and `/conflicts` — every route stays reachable through
obvious navigation, just not all from the top-level bar.

## Accessibility

- All interactive elements keyboard-reachable and focus-ringed
  (`focus-visible:ring-2 ring-[--accent]`).
- Color never the sole signal — severity and verification always carry a
  label; icons reinforce, don't replace, text.
- Contrast targets: body text ≥ 4.5:1 against its surface.
- `prefers-reduced-motion` disables non-essential animation.
- ARIA labels on icon-only controls (search, alerts, profile, nav toggle).
