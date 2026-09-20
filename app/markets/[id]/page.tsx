import { notFound } from "next/navigation";

// Individual market pages need a real market feed, which is not connected.
export default function MarketDetailPage() {
  notFound();
}
