export type AssetClass = "Energy" | "Metal" | "FX" | "Crypto" | "Equity Index";
export type GeoPressure = "Low" | "Moderate" | "High" | "Severe";

export interface MarketAsset {
  id: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  price: number;
  unit: string;
  changePct24h: number;
  geopoliticalPressure: GeoPressure;
  relevantConflictSlugs: string[];
  sparkline: number[];
}
