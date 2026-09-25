"use client";

import { PageError } from "@/components/public/route-states";

export default function RouteError({ reset }: { reset: () => void }) {
  return <PageError title="Conflict intelligence is unavailable" reset={reset} back={{ href: "/conflicts", label: "Browse conflicts" }} />;
}
