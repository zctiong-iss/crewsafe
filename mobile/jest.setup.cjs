/**
 * Test environment setup, loaded after the framework is installed.
 *
 * Everything here exists because a *native* module has no JS implementation under Jest. The
 * rule applied throughout: mock the native boundary, never the app's own logic. A mock of our
 * own code would make a test that passes while the app is broken.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// `expo-font` reaches into a native module to ask whether a face has loaded. Under Jest there
// is no native side, so it throws before any component renders.
jest.mock("expo-font", () => ({
  useFonts: () => [true, null],
  isLoaded: () => true,
  loadAsync: jest.fn(() => Promise.resolve()),
}));

// AsyncStorage is what redux-persist writes through. The package ships its own Jest mock —
// an in-memory implementation — which is the supported way to load a store under test.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// SecureStore is the token store. Nothing in these tests exercises real credentials, and the
// native keychain does not exist here.
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

// `Crypto.randomUUID` is native. A deterministic stand-in also makes idempotency keys
// predictable, which is useful when asserting on them.
jest.mock("expo-crypto", () => {
  let counter = 0;
  return {
    randomUUID: jest.fn(() => `test-uuid-${++counter}`),
  };
});

/*
 * Silence the one warning that is expected rather than informative.
 *
 * `useNativeDriver` is unsupported under the test renderer, and the progress bar deliberately
 * animates without it (see RestProgressBar). Everything else still prints: a test run that
 * hides its own warnings is how a real one gets missed.
 */
const realWarn = console.warn;
console.warn = (...args) => {
  const first = typeof args[0] === "string" ? args[0] : "";
  if (first.includes("useNativeDriver")) return;
  realWarn(...args);
};
