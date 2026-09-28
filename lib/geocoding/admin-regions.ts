// Administrative regions (oblast / province / state / historical region) with canonical CENTROIDS, for events whose
// evidence names only a region. A centroid is a render point for "somewhere in this region", never an incident
// position: events placed from it carry locationPrecision "region" and say so everywhere they are shown.
// Curated to the regions relevant to the seeded conflicts; coordinates are approximate geographic centres (about
// +/- 0.3 degrees), not administrative-centre points. A region not listed here simply stays unresolved (the report
// keeps country scope) rather than being guessed.

export interface AdminRegion {
  name: string; // canonical, e.g. "Zhytomyr Oblast"
  countryCode: string;
  lat: number;
  lng: number;
  /** Names that identify it in text. */
  aliases: string[];
  /** A bare mention ("Darfur", "Crimea") is unambiguous; otherwise the administrative suffix is required
   * ("Zhytomyr Oblast" is the region, "Zhytomyr" alone may be the city). */
  bareOk?: boolean;
}

const oblast = (base: string, countryCode: string, lat: number, lng: number, extra: string[] = [], bareOk = false): AdminRegion => ({
  name: `${base} Oblast`,
  countryCode,
  lat,
  lng,
  aliases: [`${base} Oblast`, `${base} Region`, `${base} Province`, ...extra],
  bareOk,
});
const region = (base: string, countryCode: string, lat: number, lng: number, kind: string, bareOk = false, extra: string[] = []): AdminRegion => ({
  name: `${base} ${kind}`,
  countryCode,
  lat,
  lng,
  aliases: [`${base} ${kind}`, ...extra],
  bareOk,
});

export const ADMIN_REGIONS: readonly AdminRegion[] = [
  // Ukraine
  oblast("Cherkasy", "UA", 49.45, 31.9),
  oblast("Chernihiv", "UA", 51.5, 32.5),
  oblast("Chernivtsi", "UA", 48.3, 25.9),
  oblast("Dnipropetrovsk", "UA", 48.5, 35.0, ["Dnipropetrovsk Oblast"]),
  oblast("Donetsk", "UA", 48.1, 37.8),
  oblast("Ivano-Frankivsk", "UA", 48.9, 24.7),
  oblast("Kharkiv", "UA", 49.6, 36.5),
  oblast("Kherson", "UA", 46.7, 33.4),
  oblast("Khmelnytskyi", "UA", 49.4, 26.9),
  oblast("Kirovohrad", "UA", 48.5, 32.3),
  oblast("Kyiv", "UA", 50.1, 30.2),
  oblast("Luhansk", "UA", 48.9, 39.2),
  oblast("Lviv", "UA", 49.6, 24.0),
  oblast("Mykolaiv", "UA", 47.4, 31.9),
  oblast("Odesa", "UA", 46.7, 30.5),
  oblast("Poltava", "UA", 49.6, 34.4),
  oblast("Rivne", "UA", 51.0, 26.2),
  oblast("Sumy", "UA", 50.9, 34.2),
  oblast("Ternopil", "UA", 49.5, 25.6),
  oblast("Vinnytsia", "UA", 49.1, 28.5),
  oblast("Volyn", "UA", 51.1, 25.2),
  oblast("Zakarpattia", "UA", 48.4, 23.0),
  oblast("Zaporizhzhia", "UA", 47.4, 35.5),
  oblast("Zhytomyr", "UA", 50.6, 28.4),
  { name: "Crimea", countryCode: "UA", lat: 45.3, lng: 34.4, aliases: ["Crimea", "Crimean Peninsula"], bareOk: true },
  // Russia (border regions)
  oblast("Belgorod", "RU", 50.7, 36.4),
  oblast("Kursk", "RU", 51.1, 36.0),
  oblast("Bryansk", "RU", 52.9, 33.4),
  oblast("Rostov", "RU", 47.6, 41.0),
  oblast("Voronezh", "RU", 50.9, 40.0),
  // Myanmar
  region("Sagaing", "MM", 23.0, 95.0, "Region"),
  region("Magway", "MM", 20.2, 94.9, "Region"),
  region("Mandalay", "MM", 21.8, 96.2, "Region"),
  region("Bago", "MM", 18.0, 96.5, "Region"),
  region("Yangon", "MM", 17.0, 96.1, "Region"),
  region("Ayeyarwady", "MM", 17.0, 95.2, "Region"),
  region("Tanintharyi", "MM", 12.5, 99.0, "Region"),
  region("Rakhine", "MM", 20.1, 93.6, "State", true, ["Rakhine"]),
  region("Kachin", "MM", 26.0, 97.5, "State", true, ["Kachin"]),
  region("Shan", "MM", 21.9, 98.0, "State", true, ["Shan"]),
  region("Kayin", "MM", 17.2, 97.7, "State", true, ["Kayin", "Karen State"]),
  region("Kayah", "MM", 19.2, 97.2, "State", true, ["Kayah", "Karenni State"]),
  region("Chin", "MM", 22.5, 93.6, "State"),
  region("Mon", "MM", 16.3, 97.6, "State"),
  // Sudan
  region("North Darfur", "SD", 16.0, 25.0, "State", true, ["North Darfur"]),
  region("South Darfur", "SD", 11.5, 25.0, "State", true, ["South Darfur"]),
  region("West Darfur", "SD", 13.0, 22.5, "State", true, ["West Darfur"]),
  region("Central Darfur", "SD", 12.9, 23.5, "State", true, ["Central Darfur"]),
  region("East Darfur", "SD", 11.5, 26.5, "State", true, ["East Darfur"]),
  region("North Kordofan", "SD", 13.5, 30.0, "State", true, ["North Kordofan"]),
  region("South Kordofan", "SD", 11.2, 30.5, "State", true, ["South Kordofan"]),
  region("West Kordofan", "SD", 11.5, 28.0, "State", true, ["West Kordofan"]),
  region("Blue Nile", "SD", 11.5, 34.0, "State", true, ["Blue Nile"]),
  region("Gezira", "SD", 14.4, 33.5, "State", true, ["Gezira", "Al Jazirah"]),
  region("Khartoum", "SD", 15.6, 32.5, "State"),
  // Libya (historical regions)
  { name: "Tripolitania", countryCode: "LY", lat: 32.0, lng: 13.5, aliases: ["Tripolitania"], bareOk: true },
  { name: "Cyrenaica", countryCode: "LY", lat: 31.0, lng: 22.0, aliases: ["Cyrenaica"], bareOk: true },
  { name: "Fezzan", countryCode: "LY", lat: 26.0, lng: 14.0, aliases: ["Fezzan"], bareOk: true },
  // Mexico (cartel-violence conflict regions, data/conflict-registry.json "mexico-cartel")
  region("Sinaloa", "MX", 25.0, -107.5, "State", true, ["Sinaloa"]),
  region("Michoacán", "MX", 19.35, -101.7, "State", true, ["Michoacán", "Michoacan"]),
  region("Guerrero", "MX", 17.55, -99.9, "State", true, ["Guerrero"]),
  region("Chiapas", "MX", 16.75, -92.85, "State", true, ["Chiapas"]),
  // Iran (persian-gulf-iran conflict — provinces that recur in real backlog reporting)
  region("Sistan and Baluchestan", "IR", 27.5, 61.7, "Province", true, ["Sistan and Baluchestan", "Sistan-Baluchestan", "Sistan-Balochistan"]),
  region("Khuzestan", "IR", 31.3, 48.7, "Province", true, ["Khuzestan"]),
  // Pakistan (afghanistan-pakistan / india-pakistan conflicts)
  region("Balochistan", "PK", 28.5, 65.5, "Province", true, ["Balochistan"]),
  region("Khyber Pakhtunkhwa", "PK", 34.5, 72.0, "Province", true, ["Khyber Pakhtunkhwa"]),
  region("Sindh", "PK", 26.0, 68.5, "Province", true, ["Sindh"]),
];
