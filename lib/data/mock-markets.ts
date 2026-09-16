import type { MarketAsset } from "@/lib/types";
import { seededRandom } from "@/lib/utils/seed";

function sparkline(seedKey: string, base: number, points = 24, volatility = 0.015): number[] {
  const rand = seededRandom(seedKey);
  const out: number[] = [base];
  for (let i = 1; i < points; i++) {
    const prev = out[i - 1]!;
    const change = (rand() - 0.48) * volatility * prev;
    out.push(Math.max(0.01, prev + change));
  }
  return out;
}

export const MOCK_MARKETS: MarketAsset[] = [
  {
    id: "brent",
    symbol: "BRENT",
    name: "Brent Crude",
    assetClass: "Energy",
    price: 86.42,
    unit: "USD/bbl",
    changePct24h: 2.4,
    geopoliticalPressure: "High",
    relevantConflictSlugs: ["persian-gulf", "red-sea", "russia-ukraine"],
    sparkline: sparkline("brent", 84, 30, 0.018),
  },
  {
    id: "natgas",
    symbol: "TTF",
    name: "European Natural Gas",
    assetClass: "Energy",
    price: 38.15,
    unit: "EUR/MWh",
    changePct24h: 3.1,
    geopoliticalPressure: "High",
    relevantConflictSlugs: ["russia-ukraine"],
    sparkline: sparkline("natgas", 36, 30, 0.022),
  },
  {
    id: "gold",
    symbol: "XAU",
    name: "Gold",
    assetClass: "Metal",
    price: 2648.7,
    unit: "USD/oz",
    changePct24h: 0.8,
    geopoliticalPressure: "Moderate",
    relevantConflictSlugs: ["israel-palestine", "persian-gulf"],
    sparkline: sparkline("gold", 2610, 30, 0.008),
  },
  {
    id: "eurusd",
    symbol: "EUR/USD",
    name: "Euro / US Dollar",
    assetClass: "FX",
    price: 1.062,
    unit: "",
    changePct24h: -0.3,
    geopoliticalPressure: "Moderate",
    relevantConflictSlugs: ["russia-ukraine"],
    sparkline: sparkline("eurusd", 1.07, 30, 0.004),
  },
  {
    id: "btc",
    symbol: "BTC",
    name: "Bitcoin",
    assetClass: "Crypto",
    price: 68420,
    unit: "USD",
    changePct24h: -1.6,
    geopoliticalPressure: "Low",
    relevantConflictSlugs: [],
    sparkline: sparkline("btc", 70000, 30, 0.03),
  },
  {
    id: "gxi",
    symbol: "GXI",
    name: "Global 100 Index",
    assetClass: "Equity Index",
    price: 5312.6,
    unit: "",
    changePct24h: -0.5,
    geopoliticalPressure: "Moderate",
    relevantConflictSlugs: ["taiwan-strait", "persian-gulf"],
    sparkline: sparkline("gxi", 5340, 30, 0.01),
  },
];

export function getMarketById(id: string): MarketAsset | undefined {
  return MOCK_MARKETS.find((m) => m.id === id);
}
