/**
 * The reported bug, tested against the REAL translations.
 *
 * ── WHY THIS FILE EXISTS SEPARATELY ─────────────────────────────────────────────────────
 * `RecommendationDetailScreen.test.tsx` stubs `t` to return the key it was given, which is
 * right for testing that screen's logic and useless for testing translation — every assertion
 * there would pass whether or not a single locale file existed.
 *
 * This file loads the real i18n instance and switches language for real, because the bug was
 * never a missing key. The rationale arrived from the server as finished English prose and was
 * rendered verbatim, so a supervisor who had switched to Tamil was asked to approve a plan
 * whose explanation they could not read. Only a real translation can show that fixed.
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
  useRoute: () => ({ params: { siteId: "site-1", shiftId: "shift-1", recommendationId: "rec-1" } }),
  useNavigation: () => ({ getParent: () => ({ navigate: jest.fn() }) }),
}));
jest.mock("@/api/endpoints/recommendations", () => ({
  decideRecommendation: jest.fn(),
  fetchRecommendations: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/api/endpoints/shifts", () => ({ fetchShifts: jest.fn().mockResolvedValue([]) }));
jest.mock("@/store/reducers/policySlice", () => ({
  loadPolicyVersions: () => ({ type: "policy/noop" }),
}));
jest.mock("@/store/reducers/uiSlice", () => ({ showToast: () => ({ type: "ui/noop" }) }));

import i18n from "@/localization/i18n";
import recommendationsReducer, {
  type RecommendationsState,
} from "@/store/reducers/recommendationsSlice";
import RecommendationDetailScreen from "./RecommendationDetailScreen";
import type { CurrentUser, Mitigation, Recommendation } from "@/types/domain";
import { DETERMINISTIC_FALLBACK_MODEL } from "@/types/domain";

const SUPERVISOR: CurrentUser = {
  id: "sup-1",
  username: "supervisor1",
  displayName: "Supervisor One",
  role: "SUPERVISOR",
  siteIds: ["site-1"],
};

/** The English prose a real backend sends, verbatim from `DeterministicPlanBuilder`. */
const SERVER_PROSE =
  "WBGT is 25.3°C, below 31°C, assessed against heat policy MOM-WBGT-2026.1. "
  + "3 controls are required, with 4 further suggested. This plan came straight from the "
  + "policy engine without the language model (ml_service_unavailable), so the wording is "
  + "fixed; the actions and their rule references are unaffected.";

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

function recommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: "rec-1",
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
    ...overrides,
  } as Recommendation;
}

async function renderIn(language: string, plan: Recommendation = recommendation()) {
  await act(async () => {
    await i18n.changeLanguage(language);
  });

  const state: RecommendationsState = {
    status: "ready",
    items: [plan],
    errorKey: null,
    refreshing: false,
    decidingId: null,
    generating: false,
  };
  const store = configureStore({
    reducer: {
      recommendations: recommendationsReducer,
      policy: (s = { versions: [] } as unknown) => s,
      auth: (s = { user: SUPERVISOR } as unknown) => s,
      shifts: (s = { workers: [] } as unknown) => s,
    },
    preloadedState: { recommendations: state },
  });

  return render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <RecommendationDetailScreen />
      </I18nextProvider>
    </Provider>,
  );
}

/** Every text node on screen, joined — so "is this English still here?" is one assertion. */
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

describe("the rationale follows the reader's language", () => {
  it.each([
    ["Tamil", "ta"],
    ["Malay", "ms"],
    ["Chinese", "zh-Hans"],
    ["Hindi", "hi"],
    ["Bengali", "bn"],
    ["Burmese", "my"],
  ])("renders a translated rationale in %s", async (_name, language) => {
    const { toJSON } = await renderIn(language);

    const text = allText(toJSON());

    /*
     * Built with the same values the screen passes, so this is the whole sentence a reader
     * actually sees. An earlier version of this assertion omitted them and compared against a
     * string still containing `{{wbgt}}` — it failed for the right reason, but it was checking
     * the wrong thing.
     */
    const expected = i18n.t("recommendations.rationaleReading", {
      wbgt: "25.3",
      band: i18n.t("wbgt.band.BELOW_31"),
      policyVersion: "MOM-WBGT-2026.1",
      count: 1,
      advisory: 1,
    });

    // The translated sentence is present…
    expect(text).toContain(expected);
    // …and the server's English paragraph is NOT, which is the reported bug.
    expect(text).not.toContain("assessed against heat policy");
    expect(text).not.toContain("came straight from the policy engine");
  });

  it("still reads correctly in English", async () => {
    // The fix must not localise its way out of working in the source language.
    const { toJSON } = await renderIn("en");

    const text = allText(toJSON());
    expect(text).toContain("WBGT is 25.3");
    expect(text).toContain("MOM-WBGT-2026.1");
  });

  it("re-renders when the language changes under a mounted screen", async () => {
    /*
     * The heart of the bug report: "when I switch languages, the response is still English".
     * A key-based test cannot see this — only changing the language on a live tree can.
     */
    const { toJSON } = await renderIn("en");
    expect(allText(toJSON())).toContain("WBGT is 25.3");

    await act(async () => {
      await i18n.changeLanguage("ms");
    });

    const after = allText(toJSON());
    expect(after).not.toContain("assessed against heat policy");
    expect(after).toContain("MOM-WBGT-2026.1"); // the version label is an identifier, not prose
  });
});

describe("the band and the numbers inside the sentence", () => {
  it("uses the shared wbgt.band translation rather than a second one", async () => {
    // If this ever fails, the rationale's band has drifted from the weather card's.
    const { toJSON } = await renderIn("ms");

    expect(allText(toJSON())).toContain(i18n.t("wbgt.band.BELOW_31"));
  });

  it("keeps the reading in the sentence", async () => {
    const { toJSON } = await renderIn("ta");

    expect(allText(toJSON())).toContain("25.3");
  });
});

describe("the model's own prose", () => {
  it("is suppressed for a deterministic-fallback plan", async () => {
    /*
     * That string is the same sentence the summary just rendered. Showing both would print one
     * sentence twice — once translated and once not — which looks exactly like the bug.
     */
    const { toJSON } = await renderIn("ms");

    expect(allText(toJSON())).not.toContain(SERVER_PROSE);
  });

  it("is shown and labelled for a genuinely model-drafted plan", async () => {
    /*
     * Free LLM prose cannot be reconstructed from structured data, and it is the model's
     * actual reasoning — the thing that makes an AI-drafted plan explainable. It stays,
     * marked as the model's original English so it does not read as a translation failure.
     */
    const modelProse = "Forecast WBGT crosses into the 33 °C band within 30 minutes.";
    const { toJSON } = await renderIn(
      "ms",
      recommendation({ modelVersion: "anthropic.claude-3-5-sonnet", rationale: modelProse }),
    );

    const text = allText(toJSON());
    expect(text).toContain(modelProse);
    expect(text).toContain(i18n.t("recommendations.modelWordingLabel"));
  });
});
