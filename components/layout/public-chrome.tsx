"use client";

import { usePathname } from "next/navigation";
import { NavBar } from "./nav-bar";
import { MobileTopBar } from "./mobile-top-bar";
import { MobileTabBar } from "./mobile-tab-bar";

// The consumer-facing NavBar/MobileTopBar/MobileTabBar and AdminLayout (app/admin/layout.tsx) are two
// separate, independently fixed-position chrome systems — both used to render unconditionally, so every
// /admin/* page (including /admin/login, before a session even exists) had the public header, mobile top
// bar and bottom tab bar all overlaying the admin layout's own header. Keeping them mutually exclusive by
// route, rather than redesigning either one, is the whole fix: nothing public renders under /admin.
export function PublicChrome() {
  const pathname = usePathname();
  if (pathname?.startsWith("/admin")) return null;
  return (
    <>
      <NavBar />
      <MobileTopBar />
      <MobileTabBar />
    </>
  );
}
