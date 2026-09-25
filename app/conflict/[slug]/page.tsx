import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getConflictIntelligence } from "@/lib/conflicts/intelligence";
import { resolveConflictSlug } from "@/lib/conflicts/resolve";
import { ConflictDetailClient } from "@/components/conflicts/conflict-detail-client";
import { prisma } from "@/lib/db/client";

// The canonical conflict intelligence page. Any reference (slug, database id, canonical name, curated alias) resolves
// to the ONE canonical slug; everything on the page comes from lib/conflicts/intelligence.ts (also served at
// GET /api/conflict/[id]/intelligence). Rendered on demand from database / processed state only.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const slug = await resolveConflictSlug((await params).slug);
  const row = slug ? await prisma.conflict.findUnique({ where: { slug }, select: { name: true } }) : null;
  return { title: row ? `${row.name} — Vigil` : "Conflict — Vigil" };
}

export default async function ConflictDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: ref } = await params;
  const slug = await resolveConflictSlug(ref);
  if (!slug) notFound();
  if (slug !== decodeURIComponent(ref)) redirect(`/conflict/${slug}`);
  const intel = await getConflictIntelligence(slug);
  if (!intel) notFound();
  return <ConflictDetailClient intel={intel} />;
}
