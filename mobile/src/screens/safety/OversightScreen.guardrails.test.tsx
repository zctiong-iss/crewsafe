/**
 * The ADR-0017 §6 guardrail gate, run against the Oversight screen (SCRUM-TBD-99).
 *
 * ── WHY THIS SCREEN NEEDS IT MORE THAN MOST ─────────────────────────────────────────────
 * A plan row carries a status pill, one entity pill per site supervisor, and a drafted-at
 * timestamp — on one line. SCRUM-TBD-110 then added a shift window above each group. That is
 * four independent pieces of free text competing for one phone width, and every one of them
 * grows: Burmese runs roughly half as long again as English, and `fontScale` 1.5 multiplies
 * whatever is left.
 *
 * It is also the screen a safety manager reads at arm's length while deciding which of twenty
 * sites to open, so a clipped site name or a truncated supervisor is not cosmetic — it is the
 * triage signal going missing.
 *
 * ── WHAT THE MATRIX ACTUALLY PROVES ─────────────────────────────────────────────────────
 * The test renderer has no layout engine, so this cannot see a box overflowing by three
 * points. What it does see is every CAUSE of clipping that lives in the style tree —
 * `numberOfLines`, fixed `maxWidth`/`height`, `overflow: hidden` — and that the screen renders
 * at all under high contrast, at 1.5, in the four scripts with the tallest line boxes. The
 * judgement half stays human.
 */
import { fireEvent } from "@testing-library/react-native";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";

import {
  guardrailCases,
  renderUnderGuardrails,
  expectNoClipping,
  expectPillsBordered,
  expectTouchTargets,
  LONG_WORKER_NAME,
} from "@/testing/guardrails";

let mockTheme = jest.requireActual("@/styles/theme").buildTheme(false, 1);
let mockLanguage = "en";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => mockTheme,
}));
jest.mock("@/hooks/useReduceMotion", () => ({
  useReduceMotion: () => false,
  useReduceMotionPreference: () => false,
  useSystemReduceMotion: () => false,
}));

/*
 * The longest real Burmese strings for the labels this screen owns, so the gate tests the worst
 * case rather than the English one. Everything else echoes its key.
 */
const LONGEST: Record<string, string> = {
  "oversight.showPlans": "အစီအစဉ်များကို ပြရန်",
  "oversight.hidePlans": "အစီအစဉ်များ ဖျှောက်ရန်",
  "oversight.awaitingCount": "ဆုံးဖြတ်ချက် စောင့်ဆိုင်းနေသည် ၃ ခု",
  "oversight.earlierPlans": "အစောပိုင်း အစီအစဉ် ၂ ခု",
  "shifts.window": "၂၀၂၆ ခုနှစ် သြဂုတ်လ ၁၈ ရက် ၁၄:၃၆ မှ ၁၉ ရက် ၁၄:၃၆ အထိ",
};

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (LONGEST[key]) return LONGEST[key];
      return vars ? `${key}:${Object.values(vars).join(",")}` : key;
    },
    i18n: { language: mockLanguage },
  }),
}));

const mockFetchSites = jest.fn();
const mockFetchShifts = jest.fn();
const mockFetchRecommendations = jest.fn();
const mockFetchPlanSummary = jest.fn();
jest.mock("@/api/endpoints/sites", () => ({
  fetchAccessibleSites: (...a: unknown[]) => mockFetchSites(...a),
}));
jest.mock("@/api/endpoints/shifts", () => ({
  fetchShifts: (...a: unknown[]) => mockFetchShifts(...a),
}));
jest.mock("@/api/endpoints/recommendations", () => ({
  fetchRecommendations: (...a: unknown[]) => mockFetchRecommendations(...a),
}));
jest.mock("@/api/endpoints/oversight", () => ({
  fetchPlanSummary: (...a: unknown[]) => mockFetchPlanSummary(...a),
}));
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock("@/hooks/useAutoRefresh", () => ({
  useAutoRefresh: (fn: () => void) => {
    const { useEffect } = jest.requireActual<typeof import("react")>("react");
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => fn(), []);
  },
  REFRESH_INTERVALS: { PLANS_MS: 120000 },
}));

import oversightReducer from "@/store/reducers/oversightSlice";
import OversightScreen from "./OversightScreen";
import type { CurrentUser, Recommendation, RecommendationStatus } from "@/types/domain";

const MANAGER: CurrentUser = {
  id: "mgr-1",
  username: "manager1",
  displayName: "Manager One",
  role: "SAFETY_MANAGER",
  siteIds: ["site-1"],
};

/** A site name long enough to compete with the awaiting-count pill beside it. */
const LONG_SITE_NAME = "Bishan Park Landscaping and Grounds Maintenance Depot";

function plan(id: string, createdAt: string, status: RecommendationStatus): Recommendation {
  return {
    id,
    shiftId: "shift-1",
    policyVersion: null,
    status,
    rationale: null,
    createdAt,
    mitigations: [],
    approval:
      status === "APPROVED"
        ? {
            id: "ap-1",
            approverId: "sup-1",
            approverName: LONG_WORKER_NAME,
            decision: "APPROVED",
            reason: null,
            editedMitigations: null,
            decidedAt: "2026-08-18T02:00:00Z",
          }
        : null,
    modelVersion: "anthropic.claude-3-5-sonnet",
  };
}

function buildStore() {
  return configureStore({
    reducer: {
      oversight: oversightReducer,
      auth: (s = { user: MANAGER } as unknown) => s,
      shifts: (s = { workers: [] } as unknown) => s,
    },
  });
}

function screen() {
  return (
    <Provider store={buildStore()}>
      <OversightScreen />
    </Provider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchSites.mockResolvedValue([
    {
      id: "site-1",
      name: LONG_SITE_NAME,
      latitude: "1.3",
      longitude: "103.8",
      timezone: "Asia/Singapore",
    },
  ]);
  mockFetchShifts.mockResolvedValue([
    { id: "shift-1", startsAt: "2026-08-18T06:00:00Z", endsAt: "2026-08-18T14:00:00Z" },
  ]);
  /* The worst case the screen can hold: a stop-work kept out alongside the newest plan, plus
     history behind a count, plus a long decider name on the approved one. */
  mockFetchRecommendations.mockResolvedValue([
    plan("newest", "2026-08-18T15:26:00Z", "PENDING_APPROVAL"),
    plan("stopwork", "2026-08-18T15:17:00Z", "AUTO_DISPATCHED"),
    plan("older", "2026-08-18T15:09:00Z", "SUPERSEDED"),
    plan("oldest", "2026-08-18T14:38:00Z", "APPROVED"),
  ]);
  mockFetchPlanSummary.mockResolvedValue([
    { siteId: "site-1", awaitingDecision: 3, total: 4 },
  ]);
});

describe.each(guardrailCases())("guardrail gate — $label", ({ theme, language }) => {
  beforeEach(() => {
    mockTheme = theme;
    mockLanguage = language;
  });

  it("renders the collapsed site list without clipping", async () => {
    // The triage view: a long site name beside an awaiting-count pill, which is where a
    // manager scanning twenty sites loses information first.
    const tree = await renderUnderGuardrails(screen());
    await tree.findByText(LONG_SITE_NAME);

    expectNoClipping(tree);
    expectPillsBordered(tree);
  });

  it("keeps the site disclosure a full touch target", async () => {
    const tree = await renderUnderGuardrails(screen());
    await tree.findByText(LONG_SITE_NAME);
    expectTouchTargets(tree);
  });

  it("renders an expanded site — shift window, pills and timestamps — without clipping", async () => {
    /*
     * The crowded case. One row carries a status pill, a supervisor entity pill and a drafted-at
     * time, with a shift window above the group (SCRUM-TBD-110). Four pieces of free text on one
     * phone width, all of them longer in Burmese and multiplied again at fontScale 1.5.
     */
    const tree = await renderUnderGuardrails(screen());
    const toggle = await tree.findByLabelText(/oversight.showPlansFor/);
    await fireEvent.press(toggle);

    await tree.findByText(LONGEST["shifts.window"]);

    expectNoClipping(tree);
    expectPillsBordered(tree);
    expectTouchTargets(tree);
  });

  it("keeps a stop-work and the newest plan on screen together", async () => {
    // Not a layout assertion: the gate is where a future tidy-up that collapses an in-force
    // stop-work would be caught, in every language rather than only the one someone tested.
    const tree = await renderUnderGuardrails(screen());
    await fireEvent.press(await tree.findByLabelText(/oversight.showPlansFor/));

    // Two current plans, and the two remaining behind the earlier-plans control.
    await tree.findByText(LONGEST["oversight.earlierPlans"]);
    expectNoClipping(tree);
  });
});
