import { NextResponse } from "next/server";
import { alertsSweep } from "@/lib/alerts/hooks";

// Runs the expiry sweep now (also runs after every structured-provider poll).
export const dynamic = "force-dynamic";

export async function POST() {
  await alertsSweep();
  return NextResponse.json({ ok: true });
}
