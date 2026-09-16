import type { Country } from "@/lib/types";

export const MOCK_COUNTRIES: Country[] = [
  { code: "FI", name: "Finland", region: "Europe", lat: 61.9241, lng: 25.7482, population: 5_600_000, flag: "🇫🇮" },
  { code: "UA", name: "Ukraine", region: "Europe", lat: 48.3794, lng: 31.1656, population: 36_700_000, flag: "🇺🇦" },
  { code: "RU", name: "Russia", region: "Europe", lat: 61.524, lng: 105.3188, population: 143_800_000, flag: "🇷🇺" },
  { code: "PL", name: "Poland", region: "Europe", lat: 51.9194, lng: 19.1451, population: 37_700_000, flag: "🇵🇱" },
  { code: "DE", name: "Germany", region: "Europe", lat: 51.1657, lng: 10.4515, population: 84_500_000, flag: "🇩🇪" },
  { code: "GB", name: "United Kingdom", region: "Europe", lat: 55.3781, lng: -3.436, population: 68_100_000, flag: "🇬🇧" },
  { code: "US", name: "United States", region: "Americas", lat: 37.0902, lng: -95.7129, population: 341_800_000, flag: "🇺🇸" },
  { code: "IL", name: "Israel", region: "Middle East", lat: 31.0461, lng: 34.8516, population: 9_800_000, flag: "🇮🇱" },
  { code: "PS", name: "Palestinian Territories", region: "Middle East", lat: 31.9522, lng: 35.2332, population: 5_400_000, flag: "🇵🇸" },
  { code: "LB", name: "Lebanon", region: "Middle East", lat: 33.8547, lng: 35.8623, population: 5_500_000, flag: "🇱🇧" },
  { code: "SY", name: "Syria", region: "Middle East", lat: 34.8021, lng: 38.9968, population: 23_200_000, flag: "🇸🇾" },
  { code: "IR", name: "Iran", region: "Middle East", lat: 32.4279, lng: 53.688, population: 89_200_000, flag: "🇮🇷" },
  { code: "SA", name: "Saudi Arabia", region: "Middle East", lat: 23.8859, lng: 45.0792, population: 36_900_000, flag: "🇸🇦" },
  { code: "YE", name: "Yemen", region: "Middle East", lat: 15.5527, lng: 48.5164, population: 34_400_000, flag: "🇾🇪" },
  { code: "SD", name: "Sudan", region: "Africa", lat: 12.8628, lng: 30.2176, population: 48_100_000, flag: "🇸🇩" },
  { code: "CD", name: "DR Congo", region: "Africa", lat: -4.0383, lng: 21.7587, population: 105_000_000, flag: "🇨🇩" },
  { code: "SO", name: "Somalia", region: "Africa", lat: 5.1521, lng: 46.1996, population: 18_100_000, flag: "🇸🇴" },
  { code: "ML", name: "Mali", region: "Africa", lat: 17.5707, lng: -3.9962, population: 23_300_000, flag: "🇲🇱" },
  { code: "NG", name: "Nigeria", region: "Africa", lat: 9.082, lng: 8.6753, population: 232_700_000, flag: "🇳🇬" },
  { code: "EG", name: "Egypt", region: "Africa", lat: 26.8206, lng: 30.8025, population: 115_300_000, flag: "🇪🇬" },
  { code: "MM", name: "Myanmar", region: "Asia", lat: 21.9139, lng: 95.956, population: 54_600_000, flag: "🇲🇲" },
  { code: "IN", name: "India", region: "Asia", lat: 20.5937, lng: 78.9629, population: 1_441_700_000, flag: "🇮🇳" },
  { code: "PK", name: "Pakistan", region: "Asia", lat: 30.3753, lng: 69.3451, population: 247_500_000, flag: "🇵🇰" },
  { code: "KR", name: "South Korea", region: "Asia", lat: 35.9078, lng: 127.7669, population: 51_700_000, flag: "🇰🇷" },
  { code: "KP", name: "North Korea", region: "Asia", lat: 40.3399, lng: 127.5101, population: 26_200_000, flag: "🇰🇵" },
  { code: "TW", name: "Taiwan", region: "Asia", lat: 23.6978, lng: 120.9605, population: 23_600_000, flag: "🇹🇼" },
  { code: "CN", name: "China", region: "Asia", lat: 35.8617, lng: 104.1954, population: 1_410_700_000, flag: "🇨🇳" },
  { code: "JP", name: "Japan", region: "Asia", lat: 36.2048, lng: 138.2529, population: 123_800_000, flag: "🇯🇵" },
  { code: "TR", name: "Turkey", region: "Europe", lat: 38.9637, lng: 35.2433, population: 85_700_000, flag: "🇹🇷" },
];

export function getCountryByCode(code: string): Country | undefined {
  return MOCK_COUNTRIES.find((c) => c.code === code);
}
