import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getConflictBySlug, MOCK_CONFLICTS } from "@/lib/data/mock-conflicts";
import { ConflictDetailClient } from "@/components/conflicts/conflict-detail-client";

export function generateStaticParams() {
  return MOCK_CONFLICTS.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const conflict = getConflictBySlug(slug);
  return { title: conflict ? `${conflict.name} — Vigil` : "Conflict — Vigil" };
}

export default async function ConflictDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const conflict = getConflictBySlug(slug);
  if (!conflict) notFound();

  return <ConflictDetailClient conflict={conflict} />;
}
