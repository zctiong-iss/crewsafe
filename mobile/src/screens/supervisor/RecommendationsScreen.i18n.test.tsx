/**
 * The plans LIST, tested against the real translations.
 *
 * ── WHY THIS IS A SECOND FILE, AND A SECOND BUG ─────────────────────────────────────────
 * The detail screen was fixed first, and this row was missed — so a supervisor reading in
 * Malay opened a translated plan from an English preview of it. The same untranslated server
 * prose, one screen earlier.
 *
 * `RecommendationsScreen.test.tsx` stubs `t` to return its key, which is right for testing
 * that screen's polling and toast logic and cannot see a translation bug at all: every
 * assertion there passes whether or not a locale file exists. This file uses the real i18n
 * instance so the assertion is about text a person would actually read.
 *
 * @author Justin Chua
 */
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { I18nextProvider } from "react-i18next";
import { act, render } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => jest.requireActual("@/styles/theme").defaultTheme,
}));
jest.mock("@/hooks/useReduceMotion", () => ({
  useReduceMotion: () => false,
  useSystemReduceMotion: () => false,
}));
jest.mock("@/hooks/useAutoRefresh", () => ({
  useAutoRefresh: jest.fn(),
  REFRESH_INTERVALS: { PLANS_MS: 60_000 },
}));
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: jest.fn(),
}));
jest.mock("@/api/endpoints/recommendations", () => ({
  fetchRecommendations: jest.fn().mockResolvedValue([]),
  generateRecommendation: jest.fn(),
  decideRecommendation: jest.fn(),
}));
jest.mock("@/api/endpoints/shifts", () => ({ fetchShifts: jest.fn().mockResolvedValue([]) }));
jest.mock("@/store/reducers/shiftsSlice", () => ({ loadShifts: () => ({ type: "shifts/noop" }) }));
jest.mock("@/store/reducers/uiSlice", () => ({
  showToast: () => ({ type: "ui/noop" }),
  plansListFocusChanged: (focused: boolean) => ({ type: "ui/focus", payload: focused }),
}));
jest.mock("@/notifications/useNotificationPermission", () => ({
  useNotificationPermission: () => ({
    ensure: jest.fn().mockResolvedValue(false),
    isEnabled: jest.fn().mockResolvedValue(false),
    openSystemSettings: jest.fn(),
  }),
}));

import i18n from "@/localization/i18n";
import RecommendationsScreen from "./RecommendationsScreen";
import type { CurrentUser, Mitigation, Recommendation } from "@/types/domain";
import { DETERMINISTIC_FALLBACK_MODEL } from "@/types/domain";

const SUPERVISOR: CurrentUser = {
  id: "sup-1",
  username: "supervisor1",
  displayName: "Supervisor One",
  role: "SUPERVISOR",
  siteIds: ["site-1"],
};

/** Exactly what a real backend sends, from `DeterministicPlanBuilder`. */
const SERVER_PROSE =
  "WBGT is 25.3°C, below 31°C, assessed against heat policy MOM-WBGT-2026.1. "
  + "3 controls are required, with 4 further suggested.";

const mitigation = (origin: Mitigation["origin"]): Mitigation => ({
  priority: null,
  action: "Rest 15 minutes in shade every hour",
  rationale: null,
  estimatedImpact: null,
  actionCode: "REST_15_MIN_HOURLY",
  category: "REST",
  origin,
  ruleReference: "HS-31-REST",
  appliesTo: null,
  timing: null,
});

function plan(id: string): Recommendation {
  return {
    id,
    shiftId: "shift-1",
    policyVersion: "MOM-WBGT-2026.1",
    status: "PENDING_APPROVAL",
    rationale: SERVER_PROSE,
    createdAt: "2026-08-20T13:40:00Z",
    mitigations: [mitigation("MANDATORY"), mitigation("ADVISORY")],
    approval: null,
    modelVersion: DETERMINISTIC_FALLBACK_MODEL,
    evidence: {
      observedWbgt: 25.3,
      forecastWbgt30m: 25.4,
      currentBand: "BELOW_31",
      forecastBand: "BELOW_31",
      stationId: "S128",
      lightningState: "CLEAR",
    },
  } as Recommendation;
}

/**
 * A stubbed slice, so the mount fetch cannot replace the fixtures with an empty list.
 *
 * The real reducer would run `loadRecommendations` on mount, and the mocked endpoint resolves
 * `[]` — which empties the list before a single assertion runs.
 */
function storeShowing(items: Recommendation[]) {
  return configureStore({
    reducer: {
      recommendations: (
        s = {
          status: "ready",
          items,
          errorKey: null,
          refreshing: false,
          decidingId: null,
          generating: false,
        } as unknown,
      ) => s,
      shifts: (s = { shifts: [], selectedSiteId: "site-1", workers: [] } as unknown) => s,
      auth: (s = { user: SUPERVISOR } as unknown) => s,
      ui: (s = { plansListFocused: false } as unknown) => s,
      preferences: (s = { notificationsMuted: false } as unknown) => s,
    },
  });
}

async function renderIn(language: string) {
  await act(async () => {
    await i18n.changeLanguage(language);
  });

  return render(
    <Provider store={storeShowing([plan("rec-1"), plan("rec-2")])}>
      <I18nextProvider i18n={i18n}>
        <RecommendationsScreen />
      </I18nextProvider>
    </Provider>,
  );
}

/** Every text node on screen, joined — so "is the English still here?" is one assertion. */
function allText(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(allText).join(" ");
  if (node && typeof node === "object" && "children" in node) {
    return allText((node as { children?: unknown }).children ?? []);
  }
  return "";
}

afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

it.each([
  ["Malay", "ms"],
  ["Chinese", "zh-Hans"],
  ["Tamil", "ta"],
  ["Hindi", "hi"],
  ["Bengali", "bn"],
  ["Burmese", "my"],
])("shows a translated preview in %s, not the server's English", async (_name, language) => {
  const { toJSON } = await renderIn(language);

  const text = allText(toJSON());
  const expected = i18n.t("recommendations.rationaleReading", {
    wbgt: "25.3",
    band: i18n.t("wbgt.band.BELOW_31"),
    policyVersion: "MOM-WBGT-2026.1",
    count: 1,
    advisory: 1,
  });

  expect(text).toContain(expected);
  // The reported symptom, stated as an assertion.
  expect(text).not.toContain("assessed against heat policy");
});

it("still reads correctly in English", async () => {
  const { toJSON } = await renderIn("en");

  expect(allText(toJSON())).toContain("WBGT is 25.3");
});

it("re-renders every row when the language changes under a mounted list", async () => {
  /*
   * Both rows, deliberately. The preview is built per row rather than memoised across the
   * list — memoising on anything but `t` would leave the previous language's sentence on
   * screen, which is this bug reintroduced one layer up.
   */
  const { toJSON } = await renderIn("en");
  expect(allText(toJSON()).match(/WBGT is 25\.3/g)).toHaveLength(2);

  await act(async () => {
    await i18n.changeLanguage("ms");
  });

  const after = allText(toJSON());
  expect(after).not.toContain("assessed against heat policy");
  expect(after.match(/WBGT ialah 25\.3/g)).toHaveLength(2);
});
