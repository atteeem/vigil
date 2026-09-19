import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

// Conflict families: related but separately trackable conflicts.
export async function GET() {
  const families = await prisma.conflictFamily.findMany({
    orderBy: { name: "asc" },
    include: { conflicts: { select: { id: true, slug: true, name: true, status: true }, orderBy: { name: "asc" } } },
  });
  return NextResponse.json(families.map((f) => ({ id: f.id, slug: f.slug, name: f.name, description: f.description, conflicts: f.conflicts })));
}
