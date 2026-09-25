"use client";

import { PageError } from "@/components/public/route-states";

export default function RouteError({ reset }: { reset: () => void }) {
  return <PageError title="Country intelligence is unavailable" reset={reset} back={{ href: "/world", label: "Open World Map" }} />;
}
