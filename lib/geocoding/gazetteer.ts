import type { GeocodeCandidate, GeocodingProvider } from "@/lib/geocoding/types";

// A small curated table of places relevant to the seeded conflicts
// (see prisma/seed.mjs) — used two ways: (1) as the first, fast,
// deterministic, no-network lookup in the automated draft-extraction
// heuristic (lib/ingestion/draft.ts), (2) directly as the GeocodingProvider
// in tests (tests/fixtures/geocoder.ts wraps it) so the core Playwright
// suite never depends on a live geocoding service.
//
// Several entries are deliberately ambiguous (multiple candidates for one
// name) — e.g. "Novoselivka" exists in three different Ukrainian oblasts —
// matching spec §4's explicit example of a place name that must never be
// silently resolved to one guess.
const GAZETTEER: Record<string, GeocodeCandidate[]> = {
  kyiv: [{ label: "Kyiv, Ukraine", lat: 50.45, lng: 30.52, countryCode: "UA", region: "Europe" }],
  kharkiv: [{ label: "Kharkiv, Kharkiv Oblast, Ukraine", lat: 49.99, lng: 36.23, countryCode: "UA", region: "Europe" }],
  odesa: [{ label: "Odesa, Odesa Oblast, Ukraine", lat: 46.48, lng: 30.72, countryCode: "UA", region: "Europe" }],
  kherson: [{ label: "Kherson, Kherson Oblast, Ukraine", lat: 46.64, lng: 32.61, countryCode: "UA", region: "Europe" }],
  donetsk: [{ label: "Donetsk, Donetsk Oblast, Ukraine", lat: 48.02, lng: 37.8, countryCode: "UA", region: "Europe" }],
  mariupol: [{ label: "Mariupol, Donetsk Oblast, Ukraine", lat: 47.1, lng: 37.55, countryCode: "UA", region: "Europe" }],
  bakhmut: [{ label: "Bakhmut, Donetsk Oblast, Ukraine", lat: 48.59, lng: 37.99, countryCode: "UA", region: "Europe" }],
  zaporizhzhia: [{ label: "Zaporizhzhia, Zaporizhzhia Oblast, Ukraine", lat: 47.84, lng: 35.14, countryCode: "UA", region: "Europe" }],
  sumy: [{ label: "Sumy, Sumy Oblast, Ukraine", lat: 50.91, lng: 34.8, countryCode: "UA", region: "Europe" }],
  chernihiv: [{ label: "Chernihiv, Chernihiv Oblast, Ukraine", lat: 51.5, lng: 31.29, countryCode: "UA", region: "Europe" }],
  dnipro: [{ label: "Dnipro, Dnipropetrovsk Oblast, Ukraine", lat: 48.46, lng: 35.04, countryCode: "UA", region: "Europe" }],
  lviv: [{ label: "Lviv, Lviv Oblast, Ukraine", lat: 49.84, lng: 24.03, countryCode: "UA", region: "Europe" }],
  mykolaiv: [{ label: "Mykolaiv, Mykolaiv Oblast, Ukraine", lat: 46.97, lng: 31.99, countryCode: "UA", region: "Europe" }],
  sevastopol: [{ label: "Sevastopol, Crimea", lat: 44.62, lng: 33.53, countryCode: "UA", region: "Europe" }],
  novoselivka: [
    { label: "Novoselivka, Donetsk Oblast, Ukraine", lat: 48.35, lng: 37.75, countryCode: "UA", region: "Europe" },
    { label: "Novoselivka, Kharkiv Oblast, Ukraine", lat: 49.75, lng: 36.9, countryCode: "UA", region: "Europe" },
    { label: "Novoselivka, Zaporizhzhia Oblast, Ukraine", lat: 47.55, lng: 35.9, countryCode: "UA", region: "Europe" },
  ],
  moscow: [{ label: "Moscow, Russia", lat: 55.76, lng: 37.62, countryCode: "RU", region: "Europe" }],
  belgorod: [{ label: "Belgorod, Russia", lat: 50.6, lng: 36.59, countryCode: "RU", region: "Europe" }],

  "gaza city": [{ label: "Gaza City, Gaza Strip", lat: 31.5, lng: 34.47, countryCode: "PS", region: "Middle East" }],
  gaza: [{ label: "Gaza, Gaza Strip", lat: 31.4, lng: 34.35, countryCode: "PS", region: "Middle East" }],
  rafah: [{ label: "Rafah, Gaza Strip", lat: 31.3, lng: 34.24, countryCode: "PS", region: "Middle East" }],
  "khan younis": [{ label: "Khan Younis, Gaza Strip", lat: 31.34, lng: 34.31, countryCode: "PS", region: "Middle East" }],
  "tel aviv": [{ label: "Tel Aviv, Israel", lat: 32.08, lng: 34.78, countryCode: "IL", region: "Middle East" }],
  jerusalem: [{ label: "Jerusalem", lat: 31.78, lng: 35.22, countryCode: "IL", region: "Middle East" }],
  ramallah: [{ label: "Ramallah, West Bank", lat: 31.9, lng: 35.2, countryCode: "PS", region: "Middle East" }],
  hebron: [{ label: "Hebron, West Bank", lat: 31.53, lng: 35.09, countryCode: "PS", region: "Middle East" }],

  beirut: [{ label: "Beirut, Lebanon", lat: 33.89, lng: 35.5, countryCode: "LB", region: "Middle East" }],
  tyre: [{ label: "Tyre, Lebanon", lat: 33.27, lng: 35.2, countryCode: "LB", region: "Middle East" }],
  naqoura: [{ label: "Naqoura, Lebanon", lat: 33.13, lng: 35.13, countryCode: "LB", region: "Middle East" }],

  damascus: [{ label: "Damascus, Syria", lat: 33.51, lng: 36.28, countryCode: "SY", region: "Middle East" }],
  aleppo: [{ label: "Aleppo, Syria", lat: 36.2, lng: 37.16, countryCode: "SY", region: "Middle East" }],
  idlib: [{ label: "Idlib, Syria", lat: 35.93, lng: 36.63, countryCode: "SY", region: "Middle East" }],
  homs: [{ label: "Homs, Syria", lat: 34.73, lng: 36.72, countryCode: "SY", region: "Middle East" }],
  raqqa: [{ label: "Raqqa, Syria", lat: 35.95, lng: 39.02, countryCode: "SY", region: "Middle East" }],

  tehran: [{ label: "Tehran, Iran", lat: 35.69, lng: 51.39, countryCode: "IR", region: "Middle East" }],
  isfahan: [{ label: "Isfahan, Iran", lat: 32.65, lng: 51.67, countryCode: "IR", region: "Middle East" }],
  "bandar abbas": [{ label: "Bandar Abbas, Iran", lat: 27.19, lng: 56.28, countryCode: "IR", region: "Middle East" }],

  sanaa: [{ label: "Sanaa, Yemen", lat: 15.37, lng: 44.19, countryCode: "YE", region: "Middle East" }],
  aden: [{ label: "Aden, Yemen", lat: 12.78, lng: 45.04, countryCode: "YE", region: "Middle East" }],
  hodeidah: [{ label: "Hodeidah, Yemen", lat: 14.8, lng: 42.95, countryCode: "YE", region: "Middle East" }],
  taiz: [{ label: "Taiz, Yemen", lat: 13.58, lng: 44.02, countryCode: "YE", region: "Middle East" }],
  marib: [{ label: "Marib, Yemen", lat: 15.47, lng: 45.32, countryCode: "YE", region: "Middle East" }],

  khartoum: [{ label: "Khartoum, Sudan", lat: 15.5, lng: 32.56, countryCode: "SD", region: "Africa" }],
  "el fasher": [{ label: "El Fasher, North Darfur, Sudan", lat: 13.63, lng: 25.35, countryCode: "SD", region: "Africa" }],

  goma: [{ label: "Goma, North Kivu, DRC", lat: -1.68, lng: 29.22, countryCode: "CD", region: "Africa" }],
  bukavu: [{ label: "Bukavu, South Kivu, DRC", lat: -2.5, lng: 28.86, countryCode: "CD", region: "Africa" }],
  kinshasa: [{ label: "Kinshasa, DRC", lat: -4.44, lng: 15.27, countryCode: "CD", region: "Africa" }],
  inongo: [{ label: "Inongo, Mai-Ndombe, DRC", lat: -1.95, lng: 18.28, countryCode: "CD", region: "Africa" }],
  kenge: [{ label: "Kenge, Kwango, DRC", lat: -4.87, lng: 17.04, countryCode: "CD", region: "Africa" }],

  mogadishu: [{ label: "Mogadishu, Somalia", lat: 2.05, lng: 45.32, countryCode: "SO", region: "Africa" }],
  kismayo: [{ label: "Kismayo, Somalia", lat: -0.36, lng: 42.55, countryCode: "SO", region: "Africa" }],
  baidoa: [{ label: "Baidoa, Somalia", lat: 3.12, lng: 43.65, countryCode: "SO", region: "Africa" }],

  bamako: [{ label: "Bamako, Mali", lat: 12.65, lng: -8.0, countryCode: "ML", region: "Africa" }],
  niamey: [{ label: "Niamey, Niger", lat: 13.51, lng: 2.11, countryCode: "NE", region: "Africa" }],
  agadez: [{ label: "Agadez, Niger", lat: 16.97, lng: 7.99, countryCode: "NE", region: "Africa" }],
  ouagadougou: [{ label: "Ouagadougou, Burkina Faso", lat: 12.37, lng: -1.52, countryCode: "BF", region: "Africa" }],
  "bobo-dioulasso": [{ label: "Bobo-Dioulasso, Burkina Faso", lat: 11.18, lng: -4.3, countryCode: "BF", region: "Africa" }],
  dedougou: [{ label: "Dédougou, Burkina Faso", lat: 12.46, lng: -3.46, countryCode: "BF", region: "Africa" }],

  tripoli: [{ label: "Tripoli, Libya", lat: 32.89, lng: 13.19, countryCode: "LY", region: "Africa" }],
  benghazi: [{ label: "Benghazi, Libya", lat: 32.12, lng: 20.07, countryCode: "LY", region: "Africa" }],
  misrata: [{ label: "Misrata, Libya", lat: 32.38, lng: 15.09, countryCode: "LY", region: "Africa" }],
  zawia: [{ label: "Zawia, Libya", lat: 32.75, lng: 12.73, countryCode: "LY", region: "Africa" }],
  sirte: [{ label: "Sirte, Libya", lat: 31.21, lng: 16.59, countryCode: "LY", region: "Africa" }],
  tobruk: [{ label: "Tobruk, Libya", lat: 32.08, lng: 23.96, countryCode: "LY", region: "Africa" }],

  yangon: [{ label: "Yangon, Myanmar", lat: 16.87, lng: 96.2, countryCode: "MM", region: "Asia" }],
  naypyidaw: [{ label: "Naypyidaw, Myanmar", lat: 19.76, lng: 96.08, countryCode: "MM", region: "Asia" }],
  naypyitaw: [{ label: "Naypyidaw, Myanmar", lat: 19.76, lng: 96.08, countryCode: "MM", region: "Asia" }],

  srinagar: [{ label: "Srinagar, Jammu and Kashmir", lat: 34.08, lng: 74.8, countryCode: "IN", region: "Asia" }],
  islamabad: [{ label: "Islamabad, Pakistan", lat: 33.68, lng: 73.05, countryCode: "PK", region: "Asia" }],
  "new delhi": [{ label: "New Delhi, India", lat: 28.61, lng: 77.21, countryCode: "IN", region: "Asia" }],

  seoul: [{ label: "Seoul, South Korea", lat: 37.57, lng: 126.98, countryCode: "KR", region: "Asia" }],
  pyongyang: [{ label: "Pyongyang, North Korea", lat: 39.02, lng: 125.75, countryCode: "KP", region: "Asia" }],

  taipei: [{ label: "Taipei, Taiwan", lat: 25.03, lng: 121.57, countryCode: "TW", region: "Asia" }],

  "mexico city": [{ label: "Mexico City, Mexico", lat: 19.43, lng: -99.13, countryCode: "MX", region: "Americas" }],
  tijuana: [{ label: "Tijuana, Baja California, Mexico", lat: 32.52, lng: -117.02, countryCode: "MX", region: "Americas" }],
  culiacan: [{ label: "Culiacán, Sinaloa, Mexico", lat: 24.79, lng: -107.38, countryCode: "MX", region: "Americas" }],
  "ciudad juarez": [{ label: "Ciudad Juárez, Chihuahua, Mexico", lat: 31.69, lng: -106.42, countryCode: "MX", region: "Americas" }],
  guadalajara: [{ label: "Guadalajara, Jalisco, Mexico", lat: 20.66, lng: -103.35, countryCode: "MX", region: "Americas" }],
  monterrey: [{ label: "Monterrey, Nuevo León, Mexico", lat: 25.67, lng: -100.31, countryCode: "MX", region: "Americas" }],
  acapulco: [{ label: "Acapulco, Guerrero, Mexico", lat: 16.86, lng: -99.89, countryCode: "MX", region: "Americas" }],
  chilpancingo: [{ label: "Chilpancingo, Guerrero, Mexico", lat: 17.55, lng: -99.5, countryCode: "MX", region: "Americas" }],
  morelia: [{ label: "Morelia, Michoacán, Mexico", lat: 19.7, lng: -101.19, countryCode: "MX", region: "Americas" }],
  uruapan: [{ label: "Uruapan, Michoacán, Mexico", lat: 19.42, lng: -102.07, countryCode: "MX", region: "Americas" }],
  tapachula: [{ label: "Tapachula, Chiapas, Mexico", lat: 14.9, lng: -92.26, countryCode: "MX", region: "Americas" }],
};

export function gazetteerLookup(placeName: string): GeocodeCandidate[] {
  return GAZETTEER[placeName.trim().toLowerCase()] ?? [];
}

/** All gazetteer place names, longest-first, for text-scanning callers
 * (lib/ingestion/draft.ts) that need to find which known place a raw
 * report's title/text mentions. */
export function gazetteerPlaceNames(): string[] {
  return Object.keys(GAZETTEER).sort((a, b) => b.length - a.length);
}

export const gazetteerProvider: GeocodingProvider = {
  async search(query: string) {
    return gazetteerLookup(query);
  },
};
