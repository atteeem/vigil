import { prisma } from "@/lib/db/client";
import type { Conflict } from "@prisma/client";

export function listConflicts(): Promise<Conflict[]> {
  return prisma.conflict.findMany({ orderBy: { name: "asc" } });
}

export function getConflictBySlug(slug: string): Promise<Conflict | null> {
  return prisma.conflict.findUnique({ where: { slug } });
}
