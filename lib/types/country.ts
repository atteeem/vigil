export interface Country {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  region: "Europe" | "Middle East" | "Africa" | "Asia" | "Americas";
  lat: number;
  lng: number;
  population: number;
  flag: string;
}
