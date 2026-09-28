import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, createAdminSessionToken, timingSafeEqual } from "@/lib/admin/auth";

// The only unauthenticated admin endpoint by design (see middleware.ts). Deliberately returns the exact
// same generic error for "no password configured" and "wrong password" — never reveals which credential
// component was correct or whether the server is even configured, per spec.
export async function POST(request: Request) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  const submitted = typeof body.password === "string" ? body.password : "";

  if (!adminPassword || !submitted || !timingSafeEqual(submitted, adminPassword)) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const token = await createAdminSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 12, // 12h, matches lib/admin/auth.ts's own token expiry
  });
  return res;
}
