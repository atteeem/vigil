// Single source of truth for the admin-auth test-bypass value (lib/admin/auth.ts's isTestBypass), shared
// by playwright.config.ts (which sets it as the ADMIN_TEST_BYPASS_SECRET env var for the test server AND
// as the default x-admin-test-bypass header for every request) and tests/admin-auth.spec.ts (which needs
// the exact same literal to explicitly send, or deliberately omit, that header).
export const ADMIN_TEST_BYPASS_SECRET = "playwright-admin-bypass";
