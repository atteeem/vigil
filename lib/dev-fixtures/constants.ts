/**
 * DEV / TEST FIXTURES ONLY. Nothing under app/, components/, hooks/ or lib/
 * (outside lib/dev-fixtures and lib/testing) may import this directory —
 * tests/public-data.spec.ts enforces that. Production reads the database.
 *
 * Fixed reference "now" for the fixture data below, so generated timestamps are
 * deterministic.
 */
export const MOCK_NOW = "2026-09-16T15:00:00.000Z";
