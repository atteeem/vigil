import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublicConflictDetail } from "@/lib/public/conflict-detail";
import { ConflictDetailClient } from "@/components/conflicts/conflict-detail-client";

// Real conflict intelligence page: registry geography, scores, DB events,
// actors, territorial control, sources and coverage. Rendered on demand.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getPublicConflictDetail(slug);
  return { title: detail ? `${detail.conflict.name} — Vigil` : "Conflict — Vigil" };
}

export default async function ConflictDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = await getPublicConflictDetail(slug);
  if (!detail) notFound();
  return <ConflictDetailClient detail={detail} />;
}
