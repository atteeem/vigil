// Primary navigation, shared by the desktop header and the mobile tab bar. `match` decides the active section, so an
// entity page lights up the section it belongs to (a conflict page -> Conflicts, the watchlist -> For You).

export interface NavItem {
  href: string;
  label: string;
  match: (pathname: string) => boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Overview", match: (p) => p === "/" || p.startsWith("/brief") || p.startsWith("/intel") },
  { href: "/world", label: "Live Map", match: (p) => p.startsWith("/world") },
  { href: "/for-you", label: "For You", match: (p) => p.startsWith("/for-you") || p.startsWith("/watchlist") },
  { href: "/conflicts", label: "Conflicts", match: (p) => p.startsWith("/conflicts") || p.startsWith("/conflict/") },
  { href: "/markets", label: "Markets", match: (p) => p.startsWith("/markets") },
];

export const activeNavHref = (pathname: string): string | null => NAV_ITEMS.find((i) => i.match(pathname))?.href ?? null;
