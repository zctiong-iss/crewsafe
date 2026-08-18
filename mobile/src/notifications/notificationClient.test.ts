/**
 * The boundary module's own decisions, with the operating system mocked out.
 *
 * expo-notifications is mocked in `jest.setup.cjs`, so what is under test here is the logic
 * this file adds on top of it: the past-deadline guard, the permission normalisation, and the
 * data-key matching that cancellation depends on. Each of those fails silently in production
 * — a notification that does not arrive, or one that arrives when it should not — which is
 * exactly the shape that needs a test rather than a manual pass.
 *
 * @author Justin Chua
 */
import * as Notifications from "expo-notifications";

import {
  cancelScheduledFor,
  getPermission,
  presentNow,
  requestPermission,
  scheduleAt,
} from "./notificationClient";

const mocked = Notifications as jest.Mocked<typeof Notifications>;

const MINUTE = 60_000;

beforeEach(() => {
  jest.clearAllMocks();
  (mocked.getPermissionsAsync as jest.Mock).mockResolvedValue({
    status: "granted",
    canAskAgain: true,
  });
  (mocked.scheduleNotificationAsync as jest.Mock).mockResolvedValue("notification-id");
  (mocked.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValue([]);
});

describe("permission", () => {
  it("reports granted", async () => {
    await expect(getPermission()).resolves.toBe("granted");
  });

  it("treats a refusal that cannot be re-asked as denied, not undetermined", async () => {
    /*
     * The distinction the whole permission flow rests on. iOS sets `canAskAgain` false after a
     * refusal, and calling `requestPermissionsAsync` then resolves false without showing
     * anything — so reporting it as "undetermined" would have the app queue up a prompt the
     * OS will never display, and the user would be shown a rationale dialog leading nowhere.
     */
    (mocked.getPermissionsAsync as jest.Mock).mockResolvedValue({
      status: "undetermined",
      canAskAgain: false,
    });

    await expect(getPermission()).resolves.toBe("denied");
  });

  it("reports undetermined only when the prompt can still be shown", async () => {
    (mocked.getPermissionsAsync as jest.Mock).mockResolvedValue({
      status: "undetermined",
      canAskAgain: true,
    });

    await expect(getPermission()).resolves.toBe("undetermined");
  });

  it("degrades to denied rather than throwing when the OS call fails", async () => {
    // Nothing here is worth taking a screen down for. A caller that cannot notify still has
    // to render the rest timer.
    (mocked.getPermissionsAsync as jest.Mock).mockRejectedValue(new Error("no native module"));

    await expect(getPermission()).resolves.toBe("denied");
  });

  it("never asks for critical alerts", async () => {
    /*
     * Overriding silent mode on iOS needs Apple's Critical Alerts entitlement, which this app
     * does not hold — and requesting a capability the app is not entitled to makes the WHOLE
     * request fail rather than degrade, costing the ordinary permission too.
     */
    (mocked.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: "granted" });

    await requestPermission();

    const options = (mocked.requestPermissionsAsync as jest.Mock).mock.calls[0][0];
    expect(options.ios).not.toHaveProperty("allowCriticalAlerts");
  });
});

describe("scheduling", () => {
  it("hands the deadline to the OS as a date trigger", async () => {
    const at = Date.now() + 10 * MINUTE;

    await scheduleAt({ title: "Rest complete", body: "You rested for 10 minutes.", at });

    const call = (mocked.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(call.trigger.type).toBe("date");
    expect((call.trigger.date as Date).getTime()).toBe(at);
  });

  it("drops a deadline that has already passed instead of firing it immediately", async () => {
    /*
     * expo-notifications fires a past DATE trigger straight away. The one way to reach that
     * branch is a rest whose deadline expired while the app was closed — so the default
     * behaviour would buzz "your rest is over" long after the worker went back to work, at a
     * moment that implies it just happened.
     */
    await expect(
      scheduleAt({ title: "Rest complete", body: "…", at: Date.now() - MINUTE }),
    ).resolves.toBeNull();

    expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("schedules nothing without permission", async () => {
    (mocked.getPermissionsAsync as jest.Mock).mockResolvedValue({
      status: "denied",
      canAskAgain: false,
    });

    await expect(
      scheduleAt({ title: "Rest complete", body: "…", at: Date.now() + MINUTE }),
    ).resolves.toBeNull();
    expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("returns null rather than throwing when the OS refuses the schedule", async () => {
    (mocked.scheduleNotificationAsync as jest.Mock).mockRejectedValue(new Error("quota"));

    await expect(
      scheduleAt({ title: "Rest complete", body: "…", at: Date.now() + MINUTE }),
    ).resolves.toBeNull();
  });

  it("carries its data through, because cancellation matches on it", async () => {
    await scheduleAt({
      title: "Rest complete",
      body: "…",
      at: Date.now() + MINUTE,
      data: { restDispatchId: "d1" },
    });

    const call = (mocked.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(call.content.data).toEqual({ restDispatchId: "d1" });
  });

  it("presents immediately with a null trigger", async () => {
    await expect(presentNow("New plan drafted", "…")).resolves.toBe(true);

    const call = (mocked.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(call.trigger).toBeNull();
  });

  it("presents nothing without permission", async () => {
    (mocked.getPermissionsAsync as jest.Mock).mockResolvedValue({
      status: "denied",
      canAskAgain: false,
    });

    await expect(presentNow("New plan drafted", "…")).resolves.toBe(false);
    expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe("cancelling by data key", () => {
  it("cancels only the notifications tagged with that value", async () => {
    /*
     * The function the rest feature exists to get right. A missed cancellation buzzes "your
     * rest is over" for a rest that was called off — and an over-eager one silently drops
     * another worker's still-valid rest on the same device.
     */
    (mocked.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValue([
      { identifier: "n1", content: { data: { restDispatchId: "d1" } } },
      { identifier: "n2", content: { data: { restDispatchId: "d2" } } },
      { identifier: "n3", content: { data: { kind: "plan-drafted" } } },
      { identifier: "n4", content: { data: {} } },
    ]);

    await cancelScheduledFor("restDispatchId", "d1");

    const cancelled = (mocked.cancelScheduledNotificationAsync as jest.Mock).mock.calls.map(
      (call) => call[0],
    );
    expect(cancelled).toEqual(["n1"]);
  });

  it("does nothing, quietly, when there is nothing scheduled", async () => {
    await cancelScheduledFor("restDispatchId", "d1");

    expect(mocked.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  it("swallows a failure to read the scheduled list", async () => {
    // Reached from a card being dismissed. Throwing here would turn a tidy-up into a visible
    // failure on the screen that triggered it.
    (mocked.getAllScheduledNotificationsAsync as jest.Mock).mockRejectedValue(new Error("nope"));

    await expect(cancelScheduledFor("restDispatchId", "d1")).resolves.toBeUndefined();
  });
});
