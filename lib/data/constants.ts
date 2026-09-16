/**
 * Fixed reference "now" for all mock data. Using a constant instead of
 * Date.now() keeps generated timestamps, relative-time labels, and derived
 * scores identical between server render and client hydration — this is
 * mock/development data, not a live feed (see PROJECT.md).
 */
export const MOCK_NOW = "2026-09-16T15:00:00.000Z";

export const DEFAULT_BASE_COUNTRY = "FI";
