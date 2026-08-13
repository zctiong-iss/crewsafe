/**
 * LanguageSync (SCRUM-352 / FR-006).
 *
 * The one subscriber that pushes `preferences.language` into i18next, so the store stays
 * the single source of truth (see the file's own header comment). Asserts the first-launch
 * device-locale adoption, that a later device-locale change never overrides a deliberate
 * choice, and that i18next is only asked to change language when it actually disagrees with
 * the store.
 */
const mockGetLocales = jest.fn();
jest.mock("expo-localization", () => ({ getLocales: () => mockGetLocales() }));

// State lives inside the factory itself, retrieved afterward via jest.requireMock —
// LanguageSync reads `i18n.language` directly at effect time (not lazily through a hook),
// so an outer `const` the factory closes over is still unassigned at that point; see the
// same fix applied to api/client.test.ts.
jest.mock("./i18n", () => ({
  __esModule: true,
  default: { language: "en", changeLanguage: jest.fn() },
}));

import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { render } from "@testing-library/react-native";

import preferencesReducer, { initialPreferencesState } from "@/store/reducers/preferencesSlice";
import LanguageSync from "./LanguageSync";

const mockI18n = jest.requireMock("./i18n").default as { language: string; changeLanguage: jest.Mock };
const mockChangeLanguage = mockI18n.changeLanguage;

function buildStore(overrides: Partial<typeof initialPreferencesState> = {}) {
  return configureStore({
    reducer: { preferences: preferencesReducer },
    preloadedState: { preferences: { ...initialPreferencesState, ...overrides } },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockI18n.language = "en";
});

it("adopts the device's locale on first launch, when nothing was chosen explicitly", async () => {
  mockGetLocales.mockReturnValue([{ languageTag: "ta-SG" }]);
  const store = buildStore({ languageChosenExplicitly: false });

  await render(
    <Provider store={store}>
      <LanguageSync />
    </Provider>,
  );

  expect(store.getState().preferences.language).toBe("ta");
});

it("never overrides a language the user chose deliberately", async () => {
  mockGetLocales.mockReturnValue([{ languageTag: "ta-SG" }]);
  const store = buildStore({ language: "hi", languageChosenExplicitly: true });

  await render(
    <Provider store={store}>
      <LanguageSync />
    </Provider>,
  );

  expect(store.getState().preferences.language).toBe("hi");
});

it("asks i18next to change language when it disagrees with the store", async () => {
  mockGetLocales.mockReturnValue([{ languageTag: "en-US" }]);
  mockI18n.language = "en";
  const store = buildStore({ language: "ms", languageChosenExplicitly: true });

  await render(
    <Provider store={store}>
      <LanguageSync />
    </Provider>,
  );

  expect(mockChangeLanguage).toHaveBeenCalledWith("ms");
});

it("does not ask i18next to change language when it already agrees", async () => {
  mockGetLocales.mockReturnValue([{ languageTag: "en-US" }]);
  mockI18n.language = "hi";
  const store = buildStore({ language: "hi", languageChosenExplicitly: true });

  await render(
    <Provider store={store}>
      <LanguageSync />
    </Provider>,
  );

  expect(mockChangeLanguage).not.toHaveBeenCalled();
});

it("renders nothing", async () => {
  mockGetLocales.mockReturnValue([{ languageTag: "en-US" }]);
  const store = buildStore();

  const { toJSON } = await render(
    <Provider store={store}>
      <LanguageSync />
    </Provider>,
  );

  expect(toJSON()).toBeNull();
});
