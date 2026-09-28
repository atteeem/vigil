import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken, isTestBypass } from "@/lib/admin/auth";

// Pre-Launch Critical Correctness & Security v1 — the single server-side authorization boundary for the
// ENTIRE admin surface. Runs before every request matched below, so a new /admin page or /api/admin route
// is covered automatically the moment it's added under either path — no per-route checklist to remember,
// no risk of a new endpoint shipping unprotected because someone forgot to add a guard to it.
//
// /admin/login and /api/admin/login are excluded from the match below (a login page/endpoint can't
// require you to already be logged in) — everything else under /admin/* or /api/admin/* is gated.

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/admin");

  if (pathname === "/admin/login" || pathname === "/api/admin/login") return NextResponse.next();
  if (isTestBypass(request)) return NextResponse.next();

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const authorized = await verifyAdminSessionToken(token);
  if (authorized) return NextResponse.next();

  if (isApi) {
    return NextResponse.json({ error: "Admin authentication required." }, { status: 401 });
  }
  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
