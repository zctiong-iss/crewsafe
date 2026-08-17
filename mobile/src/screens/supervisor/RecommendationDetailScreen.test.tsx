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
jest.mock("@/api/endpoints/shifts", () => ({ fetchShifts: jest.fn().mockResolvedValue([]) }));
jest.mock("@/store/reducers/policySlice", () => ({ loadPolicyVersions: () => ({ type: "policy/noop" }) }));
jest.mock("@/store/reducers/uiSlice", () => ({ showToast: (p: unknown) => ({ type: "ui/showToast", payload: p }) }));

import recommendationsReducer, {
  decideRecommendation,
  type RecommendationsState,
} from "@/store/reducers/recommendationsSlice";
import RecommendationDetailScreen from "./RecommendationDetailScreen";
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
  // SCRUM-440: a lightning-immediate or WBGT-max stop-work has no Approval at all -- it
  // skipped that step entirely -- so this must not fall into the "offers buttons" branch just
  // because `approval` is null and the caller can decide. It already happened.
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
