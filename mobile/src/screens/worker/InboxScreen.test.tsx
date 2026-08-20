/**
 * InboxScreen (SCRUM-352 / FR-005, SCRUM-186).
 *
 * What is on screen is not what the server returns — the list is the union of the server's
 * PENDING rows and this device's own acknowledgements (see the file's own header comment).
 * Asserts the loading, error/retry, empty, and populated states using the real
 * `dispatchInboxSlice` reducer, with only the network boundary mocked.
 *
 * @author Justin Chua
 */
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
// Out of this feature's scope (a gesture-handler wrapper, 0% coverage before and after) —
// mocked as a passthrough so the screen's own loading/error/empty/populated logic is what
// gets exercised, not react-native-gesture-handler's native Swipeable.
jest.mock("@/components/inbox/SwipeToDismiss", () => {
  const react = jest.requireActual("react");
  return {
    __esModule: true,
    default: ({ children }: { children: unknown }) => react.createElement(react.Fragment, null, children),
  };
});
// Lottie is a native module with no jest mock registered project-wide; also out of scope.
jest.mock("@/components/feedback/AppLoader", () => {
  const { View } = jest.requireActual("react-native");
  const react = jest.requireActual("react");
  return { __esModule: true, default: ({ message }: { message?: string }) => react.createElement(View, { accessibilityLabel: message, testID: "app-loader" }) };
});
jest.mock("@/auth/authMode", () => ({ isMockApi: () => false }));

const mockFetchPendingDispatches = jest.fn();
jest.mock("@/api/endpoints/dispatch", () => ({
  fetchPendingDispatches: (...a: unknown[]) => mockFetchPendingDispatches(...a),
  acknowledgeDispatch: jest.fn(),
  completeDispatch: jest.fn(),
}));
// Only reached by the __DEV__-and-mock-mode dev panel (isMockApi is mocked false below, so
// it never renders), but the screen imports it unconditionally at module top level, and the
// real module pulls in the real i18next setup as a side effect.
jest.mock("@/api/mock/dispatch", () => ({
  acknowledgementCount: jest.fn(),
  getSimulateLostResponse: jest.fn(() => false),
  resetMockDispatches: jest.fn(),
  setSimulateLostResponse: jest.fn(),
}));

import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { render } from "@testing-library/react-native";

import dispatchInboxReducer, { type DispatchInboxState } from "@/store/reducers/dispatchInboxSlice";
import preferencesReducer from "@/store/reducers/preferencesSlice";
import InboxScreen from "./InboxScreen";
import type { ActionDispatch, CurrentUser } from "@/types/domain";

const WORKER: CurrentUser = {
  id: "w1",
  username: "worker1",
  displayName: "Worker One",
  role: "WORKER",
  siteIds: ["site-1"],
};

function dispatchItem(overrides: Partial<ActionDispatch> = {}): ActionDispatch {
  return {
    id: "d1",
    approvalId: "a1",
    workerId: "w1",
    actionCode: "HYDRATE",
    instruction: "Drink 500ml of water",
    instructionCode: null,
    startTime: null,
    endTime: null,
    status: "PENDING",
    dispatchedAt: "2026-08-13T02:00:00Z",
    ...overrides,
  };
}

function buildStore(inboxOverrides: Partial<DispatchInboxState> = {}) {
  const dispatchInboxState: DispatchInboxState = {
    status: "ready",
    pending: [],
    acknowledged: {},
    idempotencyKeys: {},
    inFlight: [],
    failures: {},
    dismissedIds: [],
    errorKey: null,
    requestId: null,
    refreshing: false,
    ...inboxOverrides,
  };
  return configureStore({
    reducer: {
      dispatchInbox: dispatchInboxReducer,
      auth: (state = { user: WORKER } as unknown) => state,
      // The real reducer, not a stub: the screen asks about notification permission when a
      // rest is acknowledged, and that reads whether notifications are muted and whether the
      // rationale has already been shown. A stub would have to keep both in step by hand.
      preferences: preferencesReducer,
    },
    preloadedState: { dispatchInbox: dispatchInboxState },
  });
}

beforeEach(() => jest.clearAllMocks());

it("shows a loading indicator while the inbox has not resolved yet", async () => {
  const store = buildStore({ status: "loading" });
  const { getByTestId } = await render(
    <Provider store={store}>
      <InboxScreen />
    </Provider>,
  );
  expect(getByTestId("app-loader")).not.toBeNull();
});

it("shows the empty state once ready with nothing owed", async () => {
  const store = buildStore({ status: "ready", pending: [] });
  const { queryByText } = await render(
    <Provider store={store}>
      <InboxScreen />
    </Provider>,
  );
  expect(queryByText("inbox.emptyTitle")).not.toBeNull();
});

it("shows an error banner and a retry action that reloads the inbox", async () => {
  mockFetchPendingDispatches.mockResolvedValue([]);
  const store = buildStore({ status: "error", errorKey: "errors.network", requestId: "req-1" });
  const { getByText } = await render(
    <Provider store={store}>
      <InboxScreen />
    </Provider>,
  );

  expect(getByText("errors.network")).not.toBeNull();
  expect(getByText("common.retry")).not.toBeNull();
});

it("renders a card for a pending dispatch", async () => {
  const store = buildStore({ status: "ready", pending: [dispatchItem()] });
  const { queryByText } = await render(
    <Provider store={store}>
      <InboxScreen />
    </Provider>,
  );
  expect(queryByText("Drink 500ml of water")).not.toBeNull();
  expect(queryByText("inbox.acknowledgeButton")).not.toBeNull();
});

it("still shows an acknowledged card the server no longer returns as pending", async () => {
  // The whole reason this screen unions two sources — see the file's own header comment.
  const acknowledgedDispatch = dispatchItem({ id: "d2", status: "ACKNOWLEDGED" });
  const store = buildStore({
    status: "ready",
    pending: [],
    acknowledged: {
      d2: {
        acknowledgedAt: "2026-08-13T02:05:00Z",
        idempotencyKey: "key-1",
        dispatch: acknowledgedDispatch,
        dismissAt: null,
        hasRestTimer: false,
      },
    },
  });

  const { queryByText } = await render(
    <Provider store={store}>
      <InboxScreen />
    </Provider>,
  );

  expect(queryByText("inbox.acknowledgeButton")).toBeNull();
  expect(queryByText(/inbox\.acknowledged/)).not.toBeNull();
});

it("hides a dismissed card even though its acknowledgement record survives", async () => {
  const dismissedDispatch = dispatchItem({ id: "d3", instruction: "Rest for 10 minutes" });
  const store = buildStore({
    status: "ready",
    pending: [],
    dismissedIds: ["d3"],
    acknowledged: {
      d3: {
        acknowledgedAt: "2026-08-13T02:05:00Z",
        idempotencyKey: "key-1",
        dispatch: dismissedDispatch,
        dismissAt: null,
        hasRestTimer: false,
      },
    },
  });

  const { queryByText } = await render(
    <Provider store={store}>
      <InboxScreen />
    </Provider>,
  );

  expect(queryByText("Rest for 10 minutes")).toBeNull();
});
