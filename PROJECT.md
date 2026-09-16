# PROJECT.md — Vigil

## Product

Vigil is a global conflict and geopolitical risk monitor. It combines a live
world event map with a personalized "what does this mean for me" layer, so a
single person — not just an analyst — can look at the world and understand
how it touches their own country, their energy bill, their portfolio, and
their sense of security.

Central proposition:

> See what is happening in the world — and understand how it affects you.

Vigil is an original product: original code, original visual design,
original naming and scoring terminology, and an original information
architecture. It is inspired by the *category* of live conflict-monitoring
maps and personal-risk platforms, but nothing here is copied from any
existing site's frontend, styling, wording, or methodology.

## Who it's for

- **Everyday concerned citizens** who want a clear, non-sensational read on
  world events without doom-scrolling social media.
- **Frequent travelers / expats** who want to know what nearby conflicts mean
  for a specific country.
- **Investors and operators** who care how geopolitical risk touches energy,
  trade, and financial markets.
- **Journalists, researchers, and analysts** who want a fast, sourced,
  clustered view of global events.

## Core value

1. **See it** — a live, cinematic 3D globe plus a detailed operational map,
   showing verified and reported events as they happen.
2. **Understand it** — every event and conflict is explained in plain
   language, with attribution and a verification status, never presented as
   settled fact when it isn't.
3. **Feel how it touches you** — a personalized, fully explainable exposure
   score translates global events into what they mean for the user's own
   country across five concrete dimensions.

## Terminology (original to Vigil)

| Term | Meaning |
|---|---|
| **Impact Score** | 0–100 estimate of how exposed a given country is to a given conflict (or overall), across five dimensions. Always framed as an *estimate*, never a prediction. |
| **Exposure Dimensions** | The five lenses Impact Score is built from: Security, Energy, Trade, Finance, Food & Supply. |
| **Global Status** | The 0–100 aggregate read of current global geopolitical tension, with a six-step label (Stable / Guarded / Elevated / High / Severe / Extreme). |
| **Severity** | The same six-step scale (Stable / Guarded / Elevated / High / Severe / Extreme), derived directly from an individual conflict's current Intensity via one centralized threshold function — never authored independently, so the two numbers can never contradict each other. |
| **Intensity** | 0–100 measure of how active a conflict currently is (event frequency, escalation signals). Severity is Intensity's label, not a separate measurement. |
| **Verification Status** | Reported / Official Claim / Unverified (single-source outcomes) or Multiple Sources / Confirmed (multi-source outcomes) / Disputed — derived from each event's source count, never authored independently, so a display can never show e.g. "Multiple Sources" next to "1 source." |
| **Situation Brief** | A short, source-grounded AI-assisted summary of what changed in a conflict over a recent window (e.g. "Last 6 Hours"). Never invents facts. |
| **Geopolitical Pressure** | The market page's language for how much current tension may be weighing on an asset — deliberately phrased as association, not causation. |

## Features (by phase)

**Phase 1 (this build):** design system, global navigation, homepage with
interactive 3D globe and mock conflict hotspots, Global Status card, personal
impact preview card, time/layer controls, mobile-first homepage, `/world`
operational map, mock event feed, `/conflicts` list, a basic conflict detail
page, full responsive layout.

**Phase 1.5 (refinement, this build):** Intel/Satellite globe view modes
with optional Conflicts/Events/Borders/Labels layers; a single centralized
six-tier severity/risk color system (new "Guarded" tier, wine-red Extreme
tier) applied consistently everywhere severity appears; navigation audit
and restructure so `/world` is a first-class nav item; a fully functional
accountless `/profile` Preferences page (localStorage-backed); severity
derived directly from intensity and verification status derived directly
from source count, so neither can contradict its underlying number; the
event self-link bug fixed; source transparency (URLs + dev-data labeling)
made visible on event/conflict detail. See DESIGN_SYSTEM.md and TASKS.md
for full detail. No real data ingestion — still entirely mock data.

**Later phases:** `/intel` regional briefings promoted to primary nav (if
warranted), `/country/[code]` pages expanded, alerts/subscriptions,
authentication (Supabase Auth) enabling synced watchlists / multi-device
preferences / notifications (Profile already marks these as auth-gated),
real data ingestion (news/RSS, conflict data, market data APIs),
AI-assisted briefing generation, push notifications.

## Product principles

- The **map** tells the user *what is happening*.
- The **Impact system** tells them *why it matters*.
- **Markets** tell them *what it may be affecting*.
- **Intel** tells them *what changed*.
- **Alerts** tell them *when they need to know*.

Every feature should serve one of these five jobs. Nothing is added because
it "sounds impressive."

## Information ethics

- Never upgrade a claim ("Government X says...") into a fact ("X happened").
- Every event carries a verification status and, where possible, multiple
  sources.
- Market movement is never attributed to a single cause; language stays in
  the register of "geopolitical pressure" / "associated risk factors."
- No sensational language, no glorified violence, no automatic graphic
  imagery.
- AI (later phase) summarizes and classifies grounded, stored source
  material — it does not independently determine truth or invent facts.
