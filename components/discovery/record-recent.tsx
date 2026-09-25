"use client";

import { useEffect } from "react";
import { recordRecent } from "@/lib/discovery/recent";

/** Remembers (locally) that this entity page was opened, for the search palette's "Recent" list. Renders nothing. */
export function RecordRecent({ type, entityKey, title, kind, href }: { type: string; entityKey: string; title: string; kind: string; href: string }) {
  useEffect(() => {
    recordRecent({ type, key: entityKey, title, kind, href });
  }, [type, entityKey, title, kind, href]);
  return null;
}
