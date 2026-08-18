/**
 * RecommendationDetailScreen (SCRUM-352 / FR-004, SCRUM-119 / US-09).
 *
 * Approve/edit/reject are all terminal — the server refuses a second decision with 409 (see
 * the file's own header comment). Asserts the approve flow end to end (through the real
 * `decideRecommendation` thunk, with only the network layer mocked), that a role without
 * decision rights sees a read-only notice instead of the three action buttons, and that a
 * decision conflict is surfaced rather than silently retried.
 *
 * Uses a real Redux store with the real `recommendationsSlice` reducer so
 * `decideRecommendation.fulfilled.match` — which the screen itself relies on — is exercised
 * for real, rather than hand-rolled. Only the network boundary (`@/api/endpoints/*`) is
 * mocked.
 */
import { configureStore } from "@reduxjs/toolkit";
import { Alert } from "react-native";
import { Provider } from "react-redux";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => jest.requireActual("@/styles/theme").defaultTheme,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
jest.mock("@/hooks/useReduceMotion", () => ({
  useReduceMotion: () => false,
  useSystemReduceMotion: () => false,
}));

/*
 * `useAutoRefresh` is captured rather than exercised: the hook has its own focus/AppState
 * behaviour and its own coverage, and running its real timer here would test React Navigation
 * instead of this screen. Holding the registered callback lets the polling guard be invoked
 * directly, which is the part this screen actually owns.
 */
const mockAutoRefresh = jest.fn();
jest.mock("@/hooks/useAutoRefresh", () => ({
  useAutoRefresh: (cb: () => void, ms: number) => mockAutoRefresh(cb, ms),
  REFRESH_INTERVALS: { PLANS_MS: 60_000 },
}));

const mockUseRoute = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useRoute: () => mockUseRoute(),
  useNavigation: () => ({ getParent: () => ({ navigate: jest.fn() }) }),
}));

const mockDecideRequest = jest.fn();
const mockFetchRecommendations = jest.fn();
jest.mock("@/api/endpoints/recommendations", () => ({
  decideRecommendation: (...args: unknown[]) => mockDecideRequest(...args),
  fetchRecommendations: (...args: unknown[]) => mockFetchRecommendations(...args),
}));
const mockFetchShifts = jest.fn().mockResolvedValue([]);
jest.mock("@/api/endpoints/shifts", () => ({
  fetchShifts: (...args: unknown[]) => mockFetchShifts(...args),
}));
jest.mock("@/store/reducers/policySlice", () => ({ loadPolicyVersions: () => ({ type: "policy/noop" }) }));
jest.mock("@/store/reducers/uiSlice", () => ({ showToast: (p: unknown) => ({ type: "ui/showToast", payload: p }) }));

import recommendationsReducer, {
  decideRecommendation,
  type RecommendationsState,
} from "@/store/reducers/recommendationsSlice";
import RecommendationDetailScreen, { mitigationFingerprint, mitigationKeys } from "./RecommendationDetailScreen";
import type { Mitigation } from "@/types/domain";

const mitigationFixture = (actionCode: string, ruleReference: string): Mitigation => ({
  priority: null,
  action: "same action",
  rationale: null,
  estimatedImpact: null,
  actionCode: actionCode as Mitigation["actionCode"],
  category: "REST",
  origin: "ADVISORY",
  ruleReference,
  appliesTo: null,
  timing: null,
});

it("derives collision-safe stable keys for distinct and duplicate mitigations", () => {
  const first = mitigationFixture("REST-A-B", "RULE");
  const second = mitigationFixture("REST-A", "B-RULE");
  const keys = mitigationKeys([first, second, first]);

  expect(mitigationFingerprint(first)).not.toBe(mitigationFingerprint(second));
  expect(new Set(keys).size).toBe(3);
  expect(mitigationKeys([second, first])[1]).toBe(keys[0]);
});
import type { CurrentUser, Recommendation } from "@/types/domain";

const SUPERVISOR: CurrentUser = {
  id: "sup-1",
  username: "supervisor1",
  displayName: "Supervisor One",
  role: "SUPERVISOR",
  siteIds: ["site-1"],
};

const SAFETY_MANAGER: CurrentUser = { ...SUPERVISOR, role: "SAFETY_MANAGER" };

function recommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: "rec-1",
    shiftId: "shift-1",
    policyVersion: null,
    status: "PENDING_APPROVAL",
    rationale: "WBGT forecast to exceed heavy-work threshold by 14:00.",
    createdAt: "2026-08-13T01:00:00Z",
    mitigations: [],
    approval: null,
    modelVersion: "anthropic.claude-3-5-sonnet",
    ...overrides,
  };
}

// `policy`, `auth`, and `shifts` are passthrough fixtures: this screen only *reads* from
// them (policy version linking, role, worker names), none of which this test's scope
// covers — only `recommendations` needs the real reducer, since `decideRecommendation`'s
// pending/fulfilled/rejected cases are exactly what this screen's own logic branches on.
function buildStore(user: CurrentUser, items: Recommendation[]) {
  const recommendationsState: RecommendationsState = {
    status: "ready",
    items,
    errorKey: null,
    refreshing: false,
    decidingId: null,
    generating: false,
  };
  return configureStore({
    reducer: {
      recommendations: recommendationsReducer,
      policy: (state = { versions: [] } as unknown) => state,
      auth: (state = { user } as unknown) => state,
      shifts: (state = { workers: [] } as unknown) => state,
    },
    preloadedState: { recommendations: recommendationsState },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseRoute.mockReturnValue({
    params: { siteId: "site-1", shiftId: "shift-1", recommendationId: "rec-1" },
  });
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

it("offers approve/edit/reject to a supervisor who may decide", async () => {
  const store = buildStore(SUPERVISOR, [recommendation()]);

  const { queryByText } = await render(
    <Provider store={store}>
      <RecommendationDetailScreen />
    </Provider>,
  );

  expect(queryByText("recommendations.approveButton")).not.toBeNull();
  expect(queryByText("recommendations.editButton")).not.toBeNull();
  expect(queryByText("recommendations.rejectButton")).not.toBeNull();
  expect(queryByText("recommendations.readOnlyNotice")).toBeNull();
});

it("shows the auto-dispatched notice, not decision buttons, even to a supervisor who may decide", async () => {
  // SCRUM-440: a lightning-immediate stop-work has no Approval at all -- it skipped that step
  // entirely -- so this must not fall into the "offers buttons" branch just because `approval`
  // is null and the caller can decide. It already happened.
  const store = buildStore(SUPERVISOR, [recommendation({ status: "AUTO_DISPATCHED" })]);

  const { queryByText } = await render(
    <Provider store={store}>
      <RecommendationDetailScreen />
    </Provider>,
  );

  expect(queryByText("recommendations.autoDispatchedNotice")).not.toBeNull();
  expect(queryByText("recommendations.approveButton")).toBeNull();
  expect(queryByText("recommendations.editButton")).toBeNull();
  expect(queryByText("recommendations.rejectButton")).toBeNull();
  expect(queryByText("recommendations.readOnlyNotice")).toBeNull();
  expect(queryByText("recommendations.decisionBySomeone")).toBeNull();
});

it("shows a read-only notice, not decision buttons, to a role that may not decide", async () => {
  // Checked client-side as well as server-side — not because the client is authoritative,
  // but because three buttons that would each 403 is a worse answer than saying so plainly.
  const store = buildStore(SAFETY_MANAGER, [recommendation()]);

  const { queryByText } = await render(
    <Provider store={store}>
      <RecommendationDetailScreen />
    </Provider>,
  );

  expect(queryByText("recommendations.readOnlyNotice")).not.toBeNull();
  expect(queryByText("recommendations.approveButton")).toBeNull();
});

it("approves through the real decideRecommendation thunk and records who decided", async () => {
  const store = buildStore(SUPERVISOR, [recommendation()]);
  mockDecideRequest.mockResolvedValue(
    recommendation({
      status: "APPROVED",
      approval: { id: "ap-1", approverId: "sup-1", decision: "APPROVED", reason: null, editedMitigations: null, decidedAt: "2026-08-13T01:05:00Z" },
    }),
  );

  const { getByText } = await render(
    <Provider store={store}>
      <RecommendationDetailScreen />
    </Provider>,
  );

  await fireEvent.press(getByText("recommendations.approveButton"));

  // The screen confirms via Alert before dispatching; invoke the confirm button's onPress
  // the way a supervisor tapping it would.
  const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
  const confirmButton = alertCall[2].find((b: { text: string }) => b.text === "recommendations.approveConfirm");
  confirmButton.onPress(); // fires `void submit(...)` — not awaitable, so wait for its effect below

  await waitFor(() => {
    expect(mockDecideRequest).toHaveBeenCalledWith("site-1", "shift-1", "rec-1", { decision: "APPROVED" });
    expect(store.getState().recommendations.items[0].status).toBe("APPROVED");
  });
});

it("shows what was already decided rather than retrying, on a decision conflict", async () => {
  const { ApiError } = jest.requireActual("@/api/errors");
  const store = buildStore(SUPERVISOR, [recommendation()]);
  mockDecideRequest.mockRejectedValue(new ApiError("conflict", "HTTP 409", 409, "req-1"));
  mockFetchRecommendations.mockResolvedValue([recommendation({ status: "REJECTED" })]);

  const { getByText } = await render(
    <Provider store={store}>
      <RecommendationDetailScreen />
    </Provider>,
  );

  await fireEvent.press(getByText("recommendations.approveButton"));

  const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
  const confirmButton = alertCall[2].find((b: { text: string }) => b.text === "recommendations.approveConfirm");
  confirmButton.onPress(); // fires `void submit(...)` — not awaitable, so wait for its effect below

  await waitFor(() => {
    expect(Alert.alert).toHaveBeenCalledWith(
      "recommendations.decisionFailedTitle",
      "recommendations.alreadyDecided",
      expect.anything(),
    );
  });
  // decidingId is released rather than left spinning forever on the conflict path.
  expect(store.getState().recommendations.decidingId).toBeNull();
});

it("verifies the thunk's own fulfilled/rejected matching, independent of the screen", () => {
  // A focused, non-UI check of the exact static method the screen calls
  // (`decideRecommendation.fulfilled.match`) — belt and braces alongside the UI-level tests
  // above, since a change to RTK's matcher shape would otherwise only fail inside a render.
  const fulfilled = decideRecommendation.fulfilled(recommendation(), "req-1", {
    siteId: "site-1",
    shiftId: "shift-1",
    recommendationId: "rec-1",
    input: { decision: "APPROVED" },
  });
  expect(decideRecommendation.fulfilled.match(fulfilled)).toBe(true);
  expect(decideRecommendation.rejected.match(fulfilled)).toBe(false);
});

/* ── The clamped "Why this was drafted" narrative (ADR-0017 §3) ─────────────────────────── */

it("clamps the drafting rationale to three lines until it is expanded", async () => {
  // The agent can write several paragraphs here. Unclamped, that pushes the approve/reject
  // buttons — the reason the supervisor opened this screen — below the fold.
  const store = buildStore(SUPERVISOR, [
    recommendation({ rationale: "A long agent narrative that runs well past three lines." }),
  ]);

  const { getByText } = await render(
    <Provider store={store}>
      <RecommendationDetailScreen />
    </Provider>,
  );

  expect(
    getByText("A long agent narrative that runs well past three lines.").props.numberOfLines,
  ).toBe(3);
});

it("unclamps the rationale on Read more and re-clamps on Read less", async () => {
  const store = buildStore(SUPERVISOR, [
    recommendation({ rationale: "A long agent narrative that runs well past three lines." }),
  ]);

  const { getByText, getByLabelText } = await render(
    <Provider store={store}>
      <RecommendationDetailScreen />
    </Provider>,
  );

  await fireEvent.press(getByLabelText("recommendations.readMore"));
  expect(
    getByText("A long agent narrative that runs well past three lines.").props.numberOfLines,
  ).toBeUndefined();

  await fireEvent.press(getByLabelText("recommendations.readLess"));
  expect(
    getByText("A long agent narrative that runs well past three lines.").props.numberOfLines,
  ).toBe(3);
});

it("exposes the Read more control as a button reporting its expanded state", async () => {
  const store = buildStore(SUPERVISOR, [recommendation()]);

  const { getByLabelText } = await render(
    <Provider store={store}>
      <RecommendationDetailScreen />
    </Provider>,
  );

  const toggle = getByLabelText("recommendations.readMore");
  expect(toggle.props.accessibilityRole).toBe("button");
  expect(toggle.props.accessibilityState.expanded).toBe(false);
});

it("renders no Read more control when there is no rationale to clamp", async () => {
  const store = buildStore(SUPERVISOR, [recommendation({ rationale: null })]);

  const { queryByLabelText } = await render(
    <Provider store={store}>
      <RecommendationDetailScreen />
    </Provider>,
  );

  expect(queryByLabelText("recommendations.readMore")).toBeNull();
});

/* ── Superseded plans are not decidable (SCRUM-291 / SCRUM-TBD-70) ──────────────────────── */

it("offers no decision buttons on a superseded plan", async () => {
  /*
   * THE REGRESSION THIS EXISTS FOR.
   *
   * `decided` is `approval !== null || autoDispatched`. A superseded plan has no approval --
   * nobody decided anything, the server replaced it because conditions moved on -- so before
   * SCRUM-TBD-70 it fell straight through to `canDecide` and offered Approve/Edit/Reject on a
   * plan that no longer applied. Approving it would either 409 or, worse, approve mitigations
   * computed for a WBGT band that had already passed.
   *
   * It mattered little while this screen loaded once on mount. Now that it polls, a plan being
   * superseded mid-read is ordinary.
   */
  const store = buildStore(SUPERVISOR, [recommendation({ status: "SUPERSEDED" })]);

  const { queryByText } = await render(
    <Provider store={store}>
      <RecommendationDetailScreen />
    </Provider>,
  );

  expect(queryByText("recommendations.supersededNotice")).not.toBeNull();
  expect(queryByText("recommendations.approveButton")).toBeNull();
  expect(queryByText("recommendations.editButton")).toBeNull();
  expect(queryByText("recommendations.rejectButton")).toBeNull();
});

it("does not mistake a superseded plan for one someone decided", async () => {
  // Different facts, different wording: "decided by someone" would be a lie here -- nobody
  // judged this plan, the conditions behind it changed.
  const store = buildStore(SUPERVISOR, [recommendation({ status: "SUPERSEDED" })]);

  const { queryByText } = await render(
    <Provider store={store}>
      <RecommendationDetailScreen />
    </Provider>,
  );

  expect(queryByText("recommendations.decisionBySomeone")).toBeNull();
});

it("still offers the decision buttons on a plan that is merely pending", async () => {
  // Guards the fix from over-reaching: only SUPERSEDED loses the buttons.
  const store = buildStore(SUPERVISOR, [recommendation({ status: "PENDING_APPROVAL" })]);

  const { queryByText } = await render(
    <Provider store={store}>
      <RecommendationDetailScreen />
    </Provider>,
  );

  expect(queryByText("recommendations.approveButton")).not.toBeNull();
  expect(queryByText("recommendations.supersededNotice")).toBeNull();
});

/* ── The screen keeps looking, but not over a supervisor's shoulder (SCRUM-TBD-70) ──────── */

it("registers a poll at the plans interval", async () => {
  const store = buildStore(SUPERVISOR, [recommendation()]);
  await render(
    <Provider store={store}>
      <RecommendationDetailScreen />
    </Provider>,
  );

  expect(mockAutoRefresh).toHaveBeenCalled();
  expect(mockAutoRefresh.mock.calls[0][1]).toBe(60_000);
});

it("refreshes on a poll tick so a supersession is noticed without user action", async () => {
  // The reason this screen polls at all: the plan being read can be replaced under it.
  const store = buildStore(SUPERVISOR, [recommendation()]);
  await render(
    <Provider store={store}>
      <RecommendationDetailScreen />
    </Provider>,
  );

  // `loadRecommendations` fetches the site's shifts first, then a plan per shift -- so the
  // shift fetch is the call that proves the thunk ran at all.
  const before = mockFetchShifts.mock.calls.length;

  const tick = mockAutoRefresh.mock.calls[0][0] as () => void;
  tick();

  await waitFor(() => {
    expect(mockFetchShifts.mock.calls.length).toBeGreaterThan(before);
  });
});

it("does not poll while a decision is in flight", async () => {
  /*
   * A refresh landing mid-decision can reorder the list the supervisor is acting on, and can
   * swap the plan under a press aimed at Approve. `decidingId` is the signal; pull-to-refresh
   * is never suppressed, because that is the supervisor choosing to refresh.
   */
  const store = buildStore(SUPERVISOR, [recommendation()]);
  await render(
    <Provider store={store}>
      <RecommendationDetailScreen />
    </Provider>,
  );

  // Put a decision in flight through the real reducer, then wait for the screen to re-render
  // with it -- the guard reads a ref written during render, not the store directly.
  store.dispatch({
    type: decideRecommendation.pending.type,
    meta: { arg: { recommendationId: "rec-1" } },
  });
  await waitFor(() => {
    expect(store.getState().recommendations.decidingId).toBe("rec-1");
  });

  const before = mockFetchShifts.mock.calls.length;
  // The LAST registered callback: each render re-registers, and only the newest one has seen
  // the in-flight decision.
  const calls = mockAutoRefresh.mock.calls;
  const tick = calls[calls.length - 1][0] as () => void;
  tick();

  expect(mockFetchShifts.mock.calls.length).toBe(before);
});

/* ── Plan provenance: model or template (SCRUM-359 / SCRUM-TBD-70) ──────────────────────── */

it("says so when no model wrote the plan", async () => {
  /*
   * THE POINT OF SURFACING modelVersion.
   *
   * `AgentDraftService` writes "deterministic-fallback" on three paths: ml-service fell back
   * internally, ml-service was unreachable or timed out, or the backend's own gate rejected the
   * model's draft. The server has reported this since SCRUM-359 and the client dropped it,
   * because the type never declared the field.
   *
   * That was survivable while a supervisor pressed Draft plan and could infer a fallback from
   * an instant response instead of a 10-20s wait. With auto-drafting there is no spinner and no
   * human in the loop, so a Bedrock outage would produce template plans every two minutes,
   * indistinguishable from agent-drafted ones.
   */
  const store = buildStore(SUPERVISOR, [
    recommendation({ modelVersion: "deterministic-fallback" }),
  ]);

  const { queryByText } = await render(
    <Provider store={store}>
      <RecommendationDetailScreen />
    </Provider>,
  );

  expect(queryByText("recommendations.noModelNotice")).not.toBeNull();
});

it("stays quiet when a model did write the plan", async () => {
  const store = buildStore(SUPERVISOR, [
    recommendation({ modelVersion: "anthropic.claude-3-5-sonnet" }),
  ]);

  const { queryByText } = await render(
    <Provider store={store}>
      <RecommendationDetailScreen />
    </Provider>,
  );

  expect(queryByText("recommendations.noModelNotice")).toBeNull();
});

it("does not claim a template wrote a plan that simply predates the field", async () => {
  // Null means "not recorded" -- recommendations drafted before SCRUM-359 carry no model
  // version at all. Asserting a fallback there would be inventing a fact about old records.
  const store = buildStore(SUPERVISOR, [recommendation({ modelVersion: null })]);

  const { queryByText } = await render(
    <Provider store={store}>
      <RecommendationDetailScreen />
    </Provider>,
  );

  expect(queryByText("recommendations.noModelNotice")).toBeNull();
});

it("still offers the decision buttons on a fallback plan", async () => {
  // A deterministic plan is a legitimate, policy-derived plan -- §8.2 guarantees the policy
  // engine ran either way. The notice informs the judgement; it must not block the decision.
  const store = buildStore(SUPERVISOR, [
    recommendation({ modelVersion: "deterministic-fallback" }),
  ]);

  const { queryByText } = await render(
    <Provider store={store}>
      <RecommendationDetailScreen />
    </Provider>,
  );

  expect(queryByText("recommendations.approveButton")).not.toBeNull();
});

/* ── Naming the workers a plan covers ──────────────────────────────────────────────────── */

/*
 * The bug these cover. `shifts.workers` belongs to whichever site the shifts screen last
 * loaded, and nothing on this screen loads it — so a supervisor resolved names only because
 * they had passed through a screen that happened to populate it, and a safety manager, who has
 * no shifts tab and can arrive straight from oversight, resolved none. Present workers rendered
 * as "no longer on this site". Note the store below holds `workers: []`, which is exactly the
 * manager's situation.
 */
it("names workers from the plan itself when the shifts slice is empty", async () => {
  const store = buildStore(SAFETY_MANAGER, [
    recommendation({
      mitigations: [
        {
          priority: "HIGH",
          action: "Rest 15 minutes without a break, every hour",
          rationale: "Heavy work in the 33°C band",
          estimatedImpact: null,
          actionCode: "REST_15_MIN_HOURLY",
          category: "REST",
          origin: "MANDATORY",
          ruleReference: "HS-33-HEAVY",
          appliesTo: ["w-1", "w-2"],
          timing: null,
        },
      ],
      workers: [
        { id: "w-1", displayName: "Kumar (Worker)" },
        { id: "w-2", displayName: "Siti (Worker)" },
      ],
    }),
  ]);

  const { queryByText } = await render(
    <Provider store={store}>
      <RecommendationDetailScreen />
    </Provider>,
  );

  await waitFor(() => expect(queryByText("Kumar (Worker)")).not.toBeNull());
  expect(queryByText("Siti (Worker)")).not.toBeNull();
  expect(queryByText("shifts.unknownWorker")).toBeNull();
});

it("still says a worker is gone when nothing can name them", async () => {
  // The fallback is now accurate: with the server naming everyone it knows, an unresolved id
  // really does mean the person is no longer there.
  const store = buildStore(SAFETY_MANAGER, [
    recommendation({
      mitigations: [
        {
          priority: "HIGH",
          action: "Rest 15 minutes without a break, every hour",
          rationale: "Heavy work in the 33°C band",
          estimatedImpact: null,
          actionCode: "REST_15_MIN_HOURLY",
          category: "REST",
          origin: "MANDATORY",
          ruleReference: "HS-33-HEAVY",
          appliesTo: ["w-gone"],
          timing: null,
        },
      ],
      workers: [],
    }),
  ]);

  const { queryByText } = await render(
    <Provider store={store}>
      <RecommendationDetailScreen />
    </Provider>,
  );

  await waitFor(() => expect(queryByText("shifts.unknownWorker")).not.toBeNull());
});
