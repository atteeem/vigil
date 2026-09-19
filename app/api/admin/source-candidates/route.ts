import { NextResponse } from "next/server";
import { listSourceCandidates, createSourceCandidate, validateCandidateInput } from "@/lib/db/repositories/source-candidates";

// Candidate-source backlog. Storing a row never fetches or scrapes the URL.
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  return NextResponse.json(await listSourceCandidates({ conflictId: p.get("conflictId") || undefined, status: p.get("status") || undefined }));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const result = validateCandidateInput(body, true);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(await createSourceCandidate(result.value), { status: 201 });
}
