/**
 * Where a tapped notification lands.
 *
 * A notification that opens the launch screen has cost an interruption and saved nothing — the
 * supervisor still has to work out which of several shifts it was about. The cases here are
 * the three shapes of tap: one carrying a plan, one carrying a batch, and one belonging to a
 * different feature entirely.
 *
 * @author Justin Chua
 */
import { render } from "@testing-library/react-native";

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

/** Captured so a test can deliver a tap without going near the OS. */
let tapHandler: ((tap: { data: Record<string, unknown> }) => void) | null = null;
const mockUnsubscribe = jest.fn();

jest.mock("./notificationClient", () => ({
  onNotificationTapped: (handler: (tap: { data: Record<string, unknown> }) => void) => {
    tapHandler = handler;
    return mockUnsubscribe;
  },
}));

import NotificationRouter from "./NotificationRouter";

async function mount() {
  const result = await render(<NotificationRouter />);
  if (!tapHandler) throw new Error("router never subscribed to taps");
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
  tapHandler = null;
});

it("opens the plan a single-plan notification names", async () => {
  await mount();

  tapHandler!({
    data: {
      kind: "plan-drafted",
      siteId: "site-1",
      shiftId: "shift-1",
      recommendationId: "rec-1",
    },
  });

  expect(mockNavigate).toHaveBeenCalledWith("RecommendationsTab", {
    screen: "RecommendationDetail",
    params: { siteId: "site-1", shiftId: "shift-1", recommendationId: "rec-1" },
  });
});

it("opens the list when the notification covered a batch", async () => {
  // A batch carries no plan by design — the list is the only screen that shows all of what
  // was announced.
  await mount();

  tapHandler!({ data: { kind: "plan-drafted" } });

  expect(mockNavigate).toHaveBeenCalledWith("RecommendationsTab", {
    screen: "RecommendationList",
  });
});

it("falls back to the list rather than navigating with a partial route", async () => {
  /*
   * The detail route is nested under site and shift. Navigating with two of the three would
   * open a screen that cannot fetch anything — landing on the list is the honest degradation.
   */
  await mount();

  tapHandler!({ data: { kind: "plan-drafted", siteId: "site-1", shiftId: "shift-1" } });

  expect(mockNavigate).toHaveBeenCalledWith("RecommendationsTab", {
    screen: "RecommendationList",
  });
});

it("ignores a rest-timer notification, which has nothing left to open", async () => {
  /*
   * Its card was cleared by the time it fired — that is what the rest ending means. Dropping
   * the worker onto an empty Alerts tab would suggest something was there to look at.
   */
  await mount();

  tapHandler!({ data: { restDispatchId: "d1" } });

  expect(mockNavigate).not.toHaveBeenCalled();
});

it("ignores a notification with no data at all", async () => {
  await mount();

  tapHandler!({ data: {} });

  expect(mockNavigate).not.toHaveBeenCalled();
});

it("unsubscribes when it unmounts", async () => {
  // The subscription outlives the component otherwise, and a second mount would route the
  // same tap twice.
  const { unmount } = await mount();

  // Awaited: RNTL 14's unmount is async, and a bare call returns before the effect cleanup
  // has run — which reads as "cleanup never happened" rather than "not awaited".
  await unmount();

  expect(mockUnsubscribe).toHaveBeenCalled();
});

it("renders nothing", async () => {
  const { toJSON } = await mount();

  expect(toJSON()).toBeNull();
});
