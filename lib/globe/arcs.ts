export interface GlobeArc {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string;
  label: string;
}

export const ENERGY_ARCS: GlobeArc[] = [
  { startLat: 26.5, startLng: 52.5, endLat: 51.9, endLng: 4.5, color: "#4CC2FF", label: "Persian Gulf → European ports" },
  { startLat: 26.5, startLng: 52.5, endLat: 1.35, endLng: 103.8, color: "#4CC2FF", label: "Persian Gulf → East Asia" },
  { startLat: 61.5, startLng: 105.3, endLat: 51.2, endLng: 10.4, color: "#4CC2FF", label: "Russian gas → Central Europe" },
  { startLat: 14.5, startLng: 42.5, endLat: 36.8, endLng: 15.5, color: "#4CC2FF", label: "Red Sea corridor → Mediterranean" },
];

export const TRADE_ARCS: GlobeArc[] = [
  { startLat: 14.5, startLng: 42.5, endLat: 1.35, endLng: 103.8, color: "#3DDC84", label: "Red Sea → Southeast Asia" },
  { startLat: 14.5, startLng: 42.5, endLat: 51.9, endLng: 4.5, color: "#3DDC84", label: "Red Sea / Suez → Europe" },
  { startLat: 23.7, startLng: 120.9, endLat: 34.0, endLng: -118.2, color: "#3DDC84", label: "Taiwan Strait → North America" },
  { startLat: 23.7, startLng: 120.9, endLat: 51.9, endLng: 4.5, color: "#3DDC84", label: "Taiwan Strait → Europe" },
];
