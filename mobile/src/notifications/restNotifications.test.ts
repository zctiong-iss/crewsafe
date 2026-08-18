/**
 * What the worker is actually told, and the cancel-first that stops them being told twice.
 *
 * @author Justin Chua
 */
interface ScheduleCall {
  title: string;
  body: string;
  at: number;
  data?: Record<string, unknown>;
}

const mockScheduleAt = jest.fn((_request: ScheduleCall) => Promise.resolve("id"));
const mockCancelFor = jest.fn((_key: string, _value: string) => Promise.resolve());

jest.mock("./notificationClient", () => ({
  scheduleAt: (request: ScheduleCall) => mockScheduleAt(request),
  cancelScheduledFor: (key: string, value: string) => mockCancelFor(key, value),
}));
jest.mock("@/localization/i18n", () => ({
  __esModule: true,
  default: {
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  },
}));

import { cancelRestEndNotification, scheduleRestEndNotification } from "./restNotifications";

const MINUTE = 60_000;
const STARTED_AT = Date.now() + MINUTE;

beforeEach(() => jest.clearAllMocks());

it("schedules for the deadline the acknowledgement recorded", async () => {
  await scheduleRestEndNotification({
    dispatchId: "d1",
    startedAt: STARTED_AT,
    dismissAt: STARTED_AT + 10 * MINUTE,
  });

  expect(mockScheduleAt).toHaveBeenCalledWith(
    expect.objectContaining({ at: STARTED_AT + 10 * MINUTE, data: { restDispatchId: "d1" } }),
  );
});

it("states how long the worker rested, from the two timestamps it scheduled against", async () => {
  /*
   * Derived from the agreed deadline rather than from a clock at delivery. The notification is
   * describing the rest that was agreed at acknowledgement, and a device whose clock moved in
   * between must not change what the worker is told they were owed.
   */
  await scheduleRestEndNotification({
    dispatchId: "d1",
    startedAt: STARTED_AT,
    dismissAt: STARTED_AT + 10 * MINUTE,
  });

  expect(mockScheduleAt.mock.calls[0]![0].body).toContain('"count":10');
});

it("rounds to whole minutes, and never to zero", async () => {
  // A worker does not want "9 minutes 58 seconds", and "you rested for 0 minutes" reads as a
  // bug rather than as a very short rest.
  await scheduleRestEndNotification({
    dispatchId: "d1",
    startedAt: STARTED_AT,
    dismissAt: STARTED_AT + 20_000,
  });

  expect(mockScheduleAt.mock.calls[0]![0].body).toContain('"count":1');
});

it("cancels any pending notification for the same dispatch before scheduling", async () => {
  /*
   * Not defensive tidiness. The same dispatch can be acknowledged twice — a retry after a
   * network failure is the designed behaviour — and without this the worker's phone would buzz
   * once per attempt, at the same moment.
   */
  await scheduleRestEndNotification({
    dispatchId: "d1",
    startedAt: STARTED_AT,
    dismissAt: STARTED_AT + 10 * MINUTE,
  });

  expect(mockCancelFor).toHaveBeenCalledWith("restDispatchId", "d1");
  expect(mockCancelFor.mock.invocationCallOrder[0]).toBeLessThan(
    mockScheduleAt.mock.invocationCallOrder[0],
  );
});

it("cancels by the dispatch id the card already has in hand", async () => {
  await cancelRestEndNotification("d1");

  expect(mockCancelFor).toHaveBeenCalledWith("restDispatchId", "d1");
});
