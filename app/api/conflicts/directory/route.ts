import { NextResponse } from "next/server";
import { getConflictDirectory } from "@/lib/public/conflict-directory";

// The conflict directory rows (lib/public/conflict-directory.ts): every registry conflict with status, severity,
// confidence, 7-day unique report count and latest incident. Database state only.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getConflictDirectory());
}
