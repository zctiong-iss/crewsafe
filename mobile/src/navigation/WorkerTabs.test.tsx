/**
 * The Alerts badge, end to end through the tab navigator (SCRUM-208).
 *
 * The selectors are unit-tested next to the slice; what this asserts is the part that only
 * shows up once assembled — that the count actually reaches the tab bar, and that the spoken
 * label says the same thing the numeral does.
 *
 * The four stacks are stubbed. This is a test about tab options, and rendering the real
 * screens would pull in navigation, polling and four screens' worth of unrelated failure
 * modes to assert on a number.
 */
import { configureStore } from "@reduxjs/toolkit";
import { NavigationContainer } from "@react-navigation/native";
import { render } from "@testing-library/react-native";
import { I18nextProvider } from "react-i18next";
import { Provider } from "react-redux";
import { Text } from "react-native";

import i18n from "@/localization/i18n";
import dispatchInbox from "@/store/reducers/dispatchInboxSlice";
import preferences from "@/store/reducers/preferencesSlice";
import auth from "@/store/reducers/authSlice";
import type { ActionDispatch } from "@/types/domain";

jest.mock("./stacks", () => {
  const { Text: RNText } = require("react-native");
  const stub = (label: string) => () => <RNText>{label}</RNText>;
  return {
    MyShiftStack: stub("my-shift"),
    InboxStack: stub("alerts"),
    WeatherStack: stub("weather"),
    ProfileStack: stub("profile"),
  };
});

// The poll is unit-tested on its own; here it would only fire network calls at a stub.
jest.mock("@/hooks/useForegroundRefresh", () => ({ useForegroundRefresh: jest.fn() }));

import WorkerTabs from "./WorkerTabs";

function dispatchWith(id: string): ActionDispatch {
  return {
    id,
    approvalId: "a1",
    workerId: "w1",
    actionCode: "HYDRATE",
    instruction: null,
    startTime: null,
    endTime: null,
    status: "PENDING",
    dispatchedAt: "2026-08-05T10:00:00.000Z",
  };
}

function acknowledgementOf(dispatch: ActionDispatch) {
  return {
    acknowledgedAt: "2026-08-05T10:20:00.000Z",
    idempotencyKey: "k-" + dispatch.id,
    dispatch,
    dismissAt: null,
    hasRestTimer: false,
  };
}

function renderTabs(inbox: { pending: ActionDispatch[]; acknowledged?: Record<string, unknown> }) {
  const store = configureStore({
    reducer: { preferences, auth, dispatchInbox },
    // Cast once, here: only the inbox slice is preloaded, and the other two are left to
    // their own initial state rather than being restated in full.
    preloadedState: {
      dispatchInbox: {
        status: "ready",
        pending: inbox.pending,
        acknowledged: inbox.acknowledged ?? {},
        idempotencyKeys: {},
        inFlight: [],
        failures: {},
        dismissedIds: [],
        errorKey: null,
        requestId: null,
        refreshing: false,
      },
    } as never,
  } as never);

  return render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <NavigationContainer>
          <WorkerTabs />
        </NavigationContainer>
      </I18nextProvider>
    </Provider>,
  );
}

describe("WorkerTabs — Alerts badge", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("labels the tab Alerts rather than Inbox", async () => {
    const { queryAllByText } = await renderTabs({ pending: [] });
    expect(queryAllByText("Alerts").length).toBeGreaterThan(0);
  });

  it("shows the outstanding count on the badge", async () => {
    const { queryAllByText } = await renderTabs({
      pending: [dispatchWith("a"), dispatchWith("b"), dispatchWith("c")],
    });
    expect(queryAllByText("3").length).toBeGreaterThan(0);
  });

  it("drops the count as actions are acknowledged", async () => {
    const acked = dispatchWith("c");
    const { queryAllByText } = await renderTabs({
      pending: [dispatchWith("a"), dispatchWith("b")],
      acknowledged: { c: acknowledgementOf(acked) },
    });
    expect(queryAllByText("2").length).toBeGreaterThan(0);
  });

  it("shows no number once everything is acknowledged", async () => {
    const acked = dispatchWith("a");
    const { queryAllByText } = await renderTabs({
      pending: [],
      acknowledged: { a: acknowledgementOf(acked) },
    });
    // A badge reading "0" would be a permanent marker that says "you have something".
    expect(queryAllByText("0")).toHaveLength(0);
  });

  it("shows the tick only when everything is acknowledged", async () => {
    // Plural queries throughout: the tab bar renders its icon set more than once, and the
    // singular `queryByTestId` throws on multiple matches rather than returning the first.
    const outstanding = await renderTabs({ pending: [dispatchWith("a")] });
    expect(outstanding.queryAllByTestId("alerts-tab-tick")).toHaveLength(0);
    expect(outstanding.queryAllByTestId("alerts-tab-bell").length).toBeGreaterThan(0);

    const acked = dispatchWith("a");
    const done = await renderTabs({ pending: [], acknowledged: { a: acknowledgementOf(acked) } });
    expect(done.queryAllByTestId("alerts-tab-tick").length).toBeGreaterThan(0);
    // Composed, not swapped — the bell is still there underneath.
    expect(done.queryAllByTestId("alerts-tab-bell").length).toBeGreaterThan(0);
  });

  /*
   * The badge is a numeral on an icon — the first thing to disappear in glare, and invisible
   * to a screen reader. If the count only exists as a badge, it does not exist for everyone.
   */
  it("states the count in words for a screen reader", async () => {
    const { queryAllByLabelText } = await renderTabs({
      pending: [dispatchWith("a"), dispatchWith("b")],
    });
    expect(queryAllByLabelText("Alerts, 2 unacknowledged").length).toBeGreaterThan(0);
  });

  it("announces the all-acknowledged state in words too", async () => {
    const acked = dispatchWith("a");
    const { queryAllByLabelText } = await renderTabs({
      pending: [],
      acknowledged: { a: acknowledgementOf(acked) },
    });
    expect(queryAllByLabelText("Alerts, all acknowledged").length).toBeGreaterThan(0);
  });
});
