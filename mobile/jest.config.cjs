/**
 * Jest configuration for the mobile app.
 *
 * ── WHY `jest-expo` AND NOT PLAIN JEST ──────────────────────────────────────────────────
 * React Native and the Expo modules ship untranspiled ESM and native-module shims that plain
 * Jest cannot parse — the first `import "react-native"` fails on syntax. The `jest-expo`
 * preset supplies the transform, the module mocks and the platform resolution that make the
 * graph loadable. Reaching for `ts-jest` or a hand-rolled `transformIgnorePatterns` instead is
 * the usual way to spend a day on this.
 *
 * ── WHAT IS MEASURED, AND WHAT IS DELIBERATELY NOT ──────────────────────────────────────
 * `collectCoverageFrom` covers `src/`. Four kinds of file are excluded, and none of them is
 * excluded to make a number look better:
 *
 *   *.d.ts                 no executable lines at all.
 *   localization/*.json    data, not code.
 *   api/mock/**            the mock server. It exists because the real endpoints do not, and
 *                          it is deleted when they land. Testing it would pin behaviour we
 *                          intend to throw away, and covering it would inflate the figure
 *                          with lines that never ship.
 *   navigation/stacks.tsx  declarative navigator wiring with no branching of its own.
 *
 * Everything else is measured, including the screens. If a screen is hard to test that is a
 * fact worth seeing in the number rather than hiding behind an exclusion.
 */
module.exports = {
  preset: "jest-expo",

  setupFilesAfterEnv: ["<rootDir>/jest.setup.cjs"],

  // The RN/Expo graph is published as untranspiled source, so it must NOT be ignored by the
  // transform the way `node_modules` normally is.
  transformIgnorePatterns: [
    // `immer` and `reselect` are here because Redux Toolkit's CJS build re-exports their
    // ESM entry points — the first `createSlice` import fails on `export {` without them.
    // That error names RTK rather than immer, which is what makes it worth a comment.
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-native-gesture-handler|react-native-size-matters|@reduxjs/toolkit|redux-persist|immer|reselect|react-redux|use-sync-external-store))",
  ],

  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/localization/*.json",
    "!src/api/mock/**",
    "!src/navigation/stacks.tsx",
  ],

  // lcov is what SonarQube reads (sonar.javascript.lcov.reportPaths); text keeps the summary
  // visible in a CI log without opening an artifact.
  coverageReporters: ["text-summary", "lcov"],

  clearMocks: true,
  restoreMocks: true,
};
