export const TIME_RANGES = ["1H", "6H", "24H", "7D", "30D"] as const;
export type TimeRange = (typeof TIME_RANGES)[number];

export const MAP_LAYERS = ["events", "conflicts", "energy", "trade"] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];
