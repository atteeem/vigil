export interface Country {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  region: "Europe" | "Middle East" | "Africa" | "Asia" | "Americas" | "Oceania";
  lat: number;
  lng: number;
  /** Only where a sourced value exists (never estimated). */
  population?: number | null;
  flag: string;
}
