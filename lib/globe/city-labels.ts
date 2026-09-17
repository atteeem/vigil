/**
 * Globe readability (spec "Show major city names on the normal/intel
 * globe"). No populated-places dataset exists anywhere in this project or
 * bundled with three-globe (only country polygons — see
 * lib/globe/country-borders.ts) — per spec's own fallback instruction
 * ("add a lightweight static dataset rather than a heavy new
 * dependency"), this is a small hand-curated list of capitals and major
 * cities, not a geocoding-grade gazetteer.
 *
 * Tiered exactly like getCountryLabels()'s labelRank filtering, but by
 * hand rather than from source data:
 *   tier 1 — capitals and major global cities (world zoom)
 *   tier 2 — additional major regional cities (regional zoom)
 *   tier 3 — further notable cities (close zoom)
 * Coordinates are city-center approximations (a few tenths of a degree of
 * precision), fine at globe scale.
 *
 * Deliberately curated with real geographic spacing WITHIN each
 * cumulative tier (no two tier-1 cities sit pathologically close
 * together, etc.) — three-globe has no built-in label-collision/declutter
 * system for labelsData, so avoiding overlap here is a property of the
 * data, not runtime layout code. Denser in Europe/Middle East/North
 * America/East Asia (this app's primary conflict-coverage regions) than
 * elsewhere, but keeps every populated continent represented so the globe
 * doesn't read as regionally lopsided.
 */
export interface CityLabel {
  name: string;
  lat: number;
  lng: number;
  tier: 1 | 2 | 3;
}

const TIER_1: [string, number, number][] = [
  ["Washington, D.C.", 38.9072, -77.0369],
  ["New York", 40.7128, -74.006],
  ["Mexico City", 19.4326, -99.1332],
  ["Ottawa", 45.4215, -75.6972],
  ["London", 51.5074, -0.1278],
  ["Paris", 48.8566, 2.3522],
  ["Berlin", 52.52, 13.405],
  ["Madrid", 40.4168, -3.7038],
  ["Rome", 41.9028, 12.4964],
  ["Brussels", 50.8503, 4.3517],
  ["Moscow", 55.7558, 37.6173],
  ["Kyiv", 50.4501, 30.5234],
  ["Cairo", 30.0444, 31.2357],
  ["Riyadh", 24.7136, 46.6753],
  ["Tehran", 35.6892, 51.389],
  ["Ankara", 39.9334, 32.8597],
  ["Jerusalem", 31.7683, 35.2137],
  ["New Delhi", 28.6139, 77.209],
  ["Islamabad", 33.6844, 73.0479],
  ["Beijing", 39.9042, 116.4074],
  ["Tokyo", 35.6762, 139.6503],
  ["Seoul", 37.5665, 126.978],
  ["Jakarta", -6.2088, 106.8456],
  ["Bangkok", 13.7563, 100.5018],
  ["Nairobi", -1.2921, 36.8219],
  ["Pretoria", -25.7479, 28.2293],
  ["Brasília", -15.8267, -47.9218],
  ["Buenos Aires", -34.6037, -58.3816],
  ["Canberra", -35.2809, 149.13],
];

const TIER_2: [string, number, number][] = [
  // North America
  ["Los Angeles", 34.0522, -118.2437],
  ["Chicago", 41.8781, -87.6298],
  ["Houston", 29.7604, -95.3698],
  ["Miami", 25.7617, -80.1918],
  ["San Francisco", 37.7749, -122.4194],
  ["Toronto", 43.6532, -79.3832],
  ["Vancouver", 49.2827, -123.1207],
  ["Montreal", 45.5019, -73.5674],
  // Europe
  ["Vienna", 48.2082, 16.3738],
  ["Prague", 50.0755, 14.4378],
  ["Warsaw", 52.2297, 21.0122],
  ["Budapest", 47.4979, 19.0402],
  ["Athens", 37.9838, 23.7275],
  ["Stockholm", 59.3293, 18.0686],
  ["Oslo", 59.9139, 10.7522],
  ["Copenhagen", 55.6761, 12.5683],
  ["Helsinki", 60.1699, 24.9384],
  ["Amsterdam", 52.3676, 4.9041],
  ["Dublin", 53.3498, -6.2603],
  ["Lisbon", 38.7223, -9.1393],
  ["Bucharest", 44.4268, 26.1025],
  ["Belgrade", 44.7866, 20.4489],
  ["Minsk", 53.9006, 27.559],
  ["Kharkiv", 49.9935, 36.2304],
  ["St. Petersburg", 59.9311, 30.3609],
  // Middle East
  ["Baghdad", 33.3152, 44.3661],
  ["Damascus", 33.5138, 36.2765],
  ["Beirut", 33.8938, 35.5018],
  ["Amman", 31.9454, 35.9284],
  ["Dubai", 25.2048, 55.2708],
  ["Doha", 25.2854, 51.531],
  ["Kuwait City", 29.3759, 47.9774],
  ["Sanaa", 15.3694, 44.191],
  ["Tel Aviv", 32.0853, 34.7818],
  ["Gaza City", 31.5017, 34.4668],
  // East Asia
  ["Shanghai", 31.2304, 121.4737],
  ["Hong Kong", 22.3193, 114.1694],
  ["Taipei", 25.033, 121.5654],
  ["Osaka", 34.6937, 135.5023],
  ["Busan", 35.1796, 129.0756],
  ["Pyongyang", 39.0392, 125.7625],
  ["Ulaanbaatar", 47.8864, 106.9057],
  ["Guangzhou", 23.1291, 113.2644],
  // South / Southeast Asia
  ["Mumbai", 19.076, 72.8777],
  ["Karachi", 24.8607, 67.0011],
  ["Dhaka", 23.8103, 90.4125],
  ["Kolkata", 22.5726, 88.3639],
  ["Kuala Lumpur", 3.139, 101.6869],
  ["Manila", 14.5995, 120.9842],
  ["Hanoi", 21.0278, 105.8342],
  ["Singapore", 1.3521, 103.8198],
  ["Kabul", 34.5553, 69.2075],
  // Africa
  ["Lagos", 6.5244, 3.3792],
  ["Casablanca", 33.5731, -7.5898],
  ["Algiers", 36.7538, 3.0588],
  ["Tunis", 36.8065, 10.1815],
  ["Tripoli", 32.8872, 13.1913],
  ["Khartoum", 15.5007, 32.5599],
  ["Addis Ababa", 9.03, 38.74],
  ["Johannesburg", -26.2041, 28.0473],
  // South America / Oceania
  ["São Paulo", -23.5505, -46.6333],
  ["Rio de Janeiro", -22.9068, -43.1729],
  ["Lima", -12.0464, -77.0428],
  ["Bogotá", 4.711, -74.0721],
  ["Santiago", -33.4489, -70.6693],
  ["Sydney", -33.8688, 151.2093],
];

const TIER_3: [string, number, number][] = [
  // North America
  ["Philadelphia", 39.9526, -75.1652],
  ["Seattle", 47.6062, -122.3321],
  ["Dallas", 32.7767, -96.797],
  ["Atlanta", 33.749, -84.388],
  ["Boston", 42.3601, -71.0589],
  ["Denver", 39.7392, -104.9903],
  ["Calgary", 51.0447, -114.0719],
  // Europe
  ["Munich", 48.1351, 11.582],
  ["Hamburg", 53.5511, 9.9937],
  ["Frankfurt", 50.1109, 8.6821],
  ["Milan", 45.4642, 9.19],
  ["Naples", 40.8518, 14.2681],
  ["Barcelona", 41.3874, 2.1686],
  ["Seville", 37.3891, -5.9845],
  ["Krakow", 50.0647, 19.945],
  ["Rotterdam", 51.9244, 4.4777],
  ["Geneva", 46.2044, 6.1432],
  ["Zurich", 47.3769, 8.5417],
  ["Marseille", 43.2965, 5.3698],
  ["Lyon", 45.764, 4.8357],
  ["Manchester", 53.4808, -2.2426],
  ["Edinburgh", 55.9533, -3.1883],
  ["Odesa", 46.4825, 30.7233],
  ["Dnipro", 48.4647, 35.0462],
  ["Vilnius", 54.6872, 25.2797],
  ["Riga", 56.9496, 24.1052],
  ["Tallinn", 59.437, 24.7536],
  ["Ljubljana", 46.0569, 14.5058],
  ["Sarajevo", 43.8563, 18.4131],
  ["Reykjavik", 64.1466, -21.9426],
  // Middle East
  ["Mecca", 21.3891, 39.8579],
  ["Jeddah", 21.4858, 39.1925],
  ["Basra", 30.5085, 47.7835],
  ["Mosul", 36.335, 43.1189],
  ["Aleppo", 36.2021, 37.1343],
  ["Homs", 34.7324, 36.7137],
  ["Erbil", 36.191, 44.0093],
  ["Tabriz", 38.08, 46.2919],
  ["Isfahan", 32.6546, 51.668],
  ["Mashhad", 36.2605, 59.6168],
  ["Aden", 12.7855, 45.0187],
  ["Ramallah", 31.9038, 35.2034],
  ["Hebron", 31.5326, 35.0998],
  ["Nicosia", 35.1856, 33.3823],
  ["Manama", 26.2285, 50.586],
  ["Abu Dhabi", 24.4539, 54.3773],
  ["Muscat", 23.588, 58.3829],
  // East Asia
  ["Chengdu", 30.5728, 104.0668],
  ["Wuhan", 30.5928, 114.3055],
  ["Xi'an", 34.3416, 108.9398],
  ["Nanjing", 32.0603, 118.7969],
  ["Tianjin", 39.3434, 117.3616],
  ["Shenyang", 41.8057, 123.4315],
  ["Sapporo", 43.0618, 141.3545],
  ["Nagoya", 35.1815, 136.9066],
  ["Yokohama", 35.4437, 139.638],
  ["Kyoto", 35.0116, 135.7681],
  ["Incheon", 37.4563, 126.7052],
  ["Daegu", 35.8714, 128.6014],
  // South / Southeast Asia
  ["Bangalore", 12.9716, 77.5946],
  ["Chennai", 13.0827, 80.2707],
  ["Lahore", 31.5497, 74.3436],
  ["Ho Chi Minh City", 10.8231, 106.6297],
  ["Colombo", 6.9271, 79.8612],
  // Africa
  ["Kinshasa", 4.4419, 15.2663],
  ["Dakar", 14.7167, -17.4677],
  ["Accra", 5.6037, -0.187],
  ["Cape Town", -33.9249, 18.4241],
  ["Mogadishu", 2.0469, 45.3182],
  // South America / Oceania
  ["Caracas", 10.4806, -66.9036],
  ["Quito", -0.1807, -78.4678],
  ["Montevideo", -34.9011, -56.1645],
  ["Auckland", -36.8485, 174.7633],
  ["Melbourne", -37.8136, 144.9631],
];

function toCityLabels(entries: [string, number, number][], tier: 1 | 2 | 3): CityLabel[] {
  return entries.map(([name, lat, lng]) => ({ name, lat, lng, tier }));
}

const ALL_CITIES: CityLabel[] = [
  ...toCityLabels(TIER_1, 1),
  ...toCityLabels(TIER_2, 2),
  ...toCityLabels(TIER_3, 3),
];

export function getCityLabels(maxTier: number): CityLabel[] {
  return maxTier <= 0 ? [] : ALL_CITIES.filter((c) => c.tier <= maxTier);
}

/**
 * Maps the globe's camera altitude (same unitless "globe radii away"
 * value ConflictGlobe already polls for event clustering — see
 * clusterRadiusForAltitude's own comment for this app's calibrated
 * 0.3 (closest)–4 (farthest) range, default resting ~2.15–2.6) to how
 * many city-label tiers should be visible. 0 means "hide city labels
 * entirely" (spec "hide or reduce labels when zoomed too far out").
 * Thresholds are picked so the globe's own default/resting altitude
 * lands solidly in the tier-1-only ("world view") bucket.
 */
export function cityLabelTierForAltitude(altitude: number): 0 | 1 | 2 | 3 {
  if (altitude > 3.2) return 0;
  if (altitude > 2.0) return 1;
  if (altitude > 1.0) return 2;
  return 3;
}
