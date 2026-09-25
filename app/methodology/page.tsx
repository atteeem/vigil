import type { Metadata } from "next";
import Link from "next/link";
import { SCORE_COPY } from "@/lib/copy/scores";
import { SourceTrustList } from "@/components/sources/source-trust-help";

export const metadata: Metadata = { title: "Methodology — Vigil", description: "How Vigil turns reports into events and conflicts, and what Severity, Impact and Confidence mean." };

const TOC = [
  ["pipeline", "Report → Event → Conflict"],
  ["scores", "Severity, Impact, Confidence"],
  ["sources", "Source classes"],
  ["corroboration", "Corroboration"],
  ["geography", "Geographic precision"],
  ["territory", "Territorial control"],
  ["timeline", "Timeline and history"],
  ["limitations", "Known limitations"],
] as const;

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-border pt-6" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-lg font-semibold text-ink">
        {title}
      </h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-ink-dim">{children}</div>
    </section>
  );
}

/** Public, plain-language methodology. Wording for scores and source classes comes from lib/copy/scores.ts. */
export default function MethodologyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-24 sm:px-6 sm:pt-28" data-testid="methodology">
      <h1 className="text-2xl font-semibold text-ink sm:text-[28px]">How Vigil works</h1>
      <p className="mt-2 text-sm text-ink-dim">What Vigil shows, where it comes from, and how much weight each piece carries. Vigil reports what sources say and how well it is supported; it does not forecast.</p>

      <nav aria-label="On this page" className="mt-5 flex flex-wrap gap-1.5">
        {TOC.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded-full border border-border px-3 py-1.5 text-xs text-ink-dim hover:text-ink">
            {label}
          </a>
        ))}
      </nav>

      <div className="mt-8 space-y-8">
        <Section id="pipeline" title="Report → Event → Conflict">
          <p>
            A <strong className="text-ink">report</strong> is one article, post or official notice from one source. Reports describing the same incident are merged into one <strong className="text-ink">event</strong>, so
            ten articles about one strike are one event with ten reports, not ten events. Events belong to a <strong className="text-ink">conflict</strong> in Vigil&apos;s registry, which records who is fighting where, and
            since when.
          </p>
          <p>Only published events appear publicly. Unmatched or unreviewed reports stay out of the public picture.</p>
        </Section>

        <Section id="scores" title="Three separate scores">
          <dl className="space-y-3">
            {(["severity", "impact", "confidence"] as const).map((k) => (
              <div key={k} data-testid={`methodology-score-${k}`}>
                <dt className="font-semibold text-ink">{SCORE_COPY[k].label}</dt>
                <dd>
                  {SCORE_COPY[k].question} {SCORE_COPY[k].note}
                </dd>
              </div>
            ))}
          </dl>
          <p>The three never feed each other: a well-documented minor incident can have high Confidence and low Severity, and a severe war far away can have low Impact for your country.</p>
        </Section>

        <Section id="sources" title="Source classes">
          <SourceTrustList />
          <p>Discovery leads (aggregators, social posts that point to a story) help Vigil find reports but are never counted as evidence.</p>
        </Section>

        <Section id="corroboration" title="Corroboration and independence groups">
          <p>
            Confidence grows with <strong className="text-ink">independent</strong> confirmation, not with volume. Reports are grouped into independence groups: one outlet is one group however many articles it publishes, and
            a syndicated copy or relay of the same article adds nothing. Party / aligned claims are shown (when enabled) but never make an event &ldquo;confirmed&rdquo; on their own.
          </p>
          <p>When sources disagree on a figure or place, Vigil shows each value with its sources and does not pick one.</p>
        </Section>

        <Section id="geography" title="Geographic precision">
          <p>
            Every event states how precisely it is located: a point, a city, a region or only a country. Region- and country-level reports are shown as such (the region or country is highlighted) and never get an invented
            exact point.
          </p>
        </Section>

        <Section id="territory" title="Territorial control vs presence and influence">
          <p>
            <strong className="text-ink">Control</strong> is reported / de-facto control, not legal sovereignty. <strong className="text-ink">Contested</strong> means control is disputed or uncertain.{" "}
            <strong className="text-ink">Influence</strong> means meaningful influence but not necessarily control, and <strong className="text-ink">presence</strong> means the actor operates in the area. Every territorial
            layer comes from a named published dataset with its provider, licence and date; Vigil does not draw its own frontlines and does not show tactical positions.
          </p>
        </Section>

        <Section id="timeline" title="Timeline and history">
          <p>
            The Live Map&apos;s timeline shows the world as it was known at a past moment: events published by then, with their state at that time. Changes to events and conflicts are recorded, so an update never silently
            rewrites the past.
          </p>
        </Section>

        <Section id="limitations" title="Known limitations">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Coverage follows the configured sources; regions with few independent outlets have fewer and less corroborated events.</li>
            <li>Territorial layers exist only where a published dataset is available.</li>
            <li>Casualty figures are what sources report; Vigil does not verify or reconcile them.</li>
            <li>The LIVE badge reflects when sources were last successfully read. When updates stop it shows DELAYED or STALE instead.</li>
          </ul>
        </Section>
      </div>

      <p className="mt-10 text-sm text-ink-dim">
        Questions about a specific item? Open it and check its sources, or <Link href="/world" className="text-accent hover:underline">open the Live Map</Link>.
      </p>
    </main>
  );
}
