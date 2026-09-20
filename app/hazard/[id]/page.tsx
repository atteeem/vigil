import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getHazardDetail } from "@/lib/hazards/query";
import { HazardDetailView } from "@/components/hazards/hazard-detail";
import { hazardHeadline } from "@/lib/hazards/headline";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const d = await getHazardDetail(id);
  return { title: d ? `${hazardHeadline(d)} — Vigil` : "Event — Vigil" };
}

/** A structured natural-hazard record (earthquake, thermal detection, wildfire, volcano, alert): the
 * provider's own data with its original link, clearly labelled as not a news report. */
export default async function HazardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getHazardDetail(id);
  if (!d) notFound();
  return (
    <main className="mx-auto max-w-2xl px-4 pb-28 pt-24 sm:px-6 sm:pt-32" data-testid="hazard-page">
      <HazardDetailView detail={d} />
      <p className="mt-6 text-xs">
        <Link href="/world" className="text-accent hover:underline">
          View on the world map
        </Link>
      </p>
    </main>
  );
}
