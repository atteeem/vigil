"use client";

import { PageError } from "@/components/public/route-states";

export default function RouteError({ reset }: { reset: () => void }) {
  return <PageError title="For You is unavailable" reset={reset} back={{ href: "/", label: "Overview" }} />;
}
