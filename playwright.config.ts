// The e2e harness — the "honest fix" the plans README has been asking for.
//
// Why it exists: everything auth-gated in this admin has shipped on green
// typecheck + green build + green unit tests, and that combination has twice
// proved nearly meaningless for behaviour that lives in dialogs, keyboards and
// sessions. `vitest` covers pure functions (src/tests/**/*.test.ts). This
// covers the parts a compiler cannot see, by driving the real UI in a real
// browser against the real dev server.
//
// TWO THINGS TO KNOW BEFORE TRUSTING A GREEN RUN HERE:
//
//  1. It runs against the LIVE Supabase project — there is no local stack.
//     So the specs are read-only by construction: they discover existing rows
//     rather than seeding, and the one spec that drives the writing composer
//     stubs `/_actions/**` so no save can ever reach the database. If you add
//     a spec, keep that property or say loudly that you didn't.
//  2. The `mobile` project is CHROMIUM at 390px, not mobile Safari. It catches
//     layout and overflow. It cannot catch the iOS keyboard/viewport bug that
//     plan 08 is actually about — `vh` units and the top layer behave
//     differently there. A phone walkthrough is still owed.
import { defineConfig, devices } from '@playwright/test';

const ADMIN_STATE = 'tests/e2e/.auth/admin.json';
const BASE_URL = 'http://localhost:4321';

export default defineConfig({
  testDir: './tests/e2e',
  // One dev server, one live database: parallel workers would race each other
  // through the same admin session and the same rows.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Mints the admin session once, then everything below reuses it.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    // Naming is what routes a spec to a project, so it's visible in the
    // filename: `*.anon.spec.ts` runs signed-out, `*.mobile.spec.ts` runs
    // narrow, everything else runs as the admin on a desktop viewport.
    {
      name: 'admin',
      use: { ...devices['Desktop Chrome'], storageState: ADMIN_STATE },
      dependencies: ['setup'],
      testMatch: /\.spec\.ts$/,
      testIgnore: [/\.anon\.spec\.ts$/, /\.mobile\.spec\.ts$/],
    },
    {
      // Deliberately NO storageState — this project is the public, and its job
      // is to prove that what the admin can see, it cannot.
      name: 'anon',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'], // only for the fixture slugs, not for the session
      testMatch: /\.anon\.spec\.ts$/,
    },
    {
      // An explicit viewport rather than devices['iPhone 13']: that descriptor
      // asks for WebKit, and pretending chromium is Safari is exactly the kind
      // of "verified" that this harness exists to stop.
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: false, // chromium's isMobile changes more than viewport; keep it honest
        hasTouch: true,
        storageState: ADMIN_STATE,
      },
      dependencies: ['setup'],
      testMatch: /\.mobile\.spec\.ts$/,
    },
  ],
  webServer: {
    command: 'npx astro dev',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 90_000,
  },
});
