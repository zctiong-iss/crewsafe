/**
 * useExpiryTimer (SCRUM-352 / FR-002).
 *
 * Fires once when a deadline passes, and re-checks on foreground return because a
 * backgrounded JS timer cannot be trusted (see the file's own header comment). Asserts the
 * scheduled-fire case, the already-passed-deadline case, the disabled case, and the
 * foreground-return re-check.
 */
import { renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";
import { useExpiryTimer } from "./useExpiryTimer";

type AppStateHandler = (state: string) => void;

/** Captures the AppState listener so a background/foreground cycle can be driven. */
function mockAppState() {
  const handlers: AppStateHandler[] = [];
  const remove = jest.fn();
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation(((_event: string, handler: AppStateHandler) => {
      handlers.push(handler);
      return { remove } as never;
    }) as never);
  return { emit: (state: string) => handlers.forEach((h) => h(state)) };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("fires onExpire once the deadline elapses", async () => {
  mockAppState();
  const onExpire = jest.fn();
  const dismissAt = Date.now() + 5000;

  await renderHook(() => useExpiryTimer(dismissAt, onExpire));
  expect(onExpire).not.toHaveBeenCalled();

  jest.advanceTimersByTime(5000);
  expect(onExpire).toHaveBeenCalledTimes(1);
});

it("fires immediately when the deadline has already passed", async () => {
  mockAppState();
  const onExpire = jest.fn();
  const dismissAt = Date.now() - 1000;

  await renderHook(() => useExpiryTimer(dismissAt, onExpire));

  expect(onExpire).toHaveBeenCalledTimes(1);
});

it("never schedules or fires when disabled", async () => {
  mockAppState();
  const onExpire = jest.fn();
  const dismissAt = Date.now() + 5000;

  await renderHook(() => useExpiryTimer(dismissAt, onExpire, false));
  jest.advanceTimersByTime(10_000);

  expect(onExpire).not.toHaveBeenCalled();
});

it("never schedules when there is no deadline", async () => {
  mockAppState();
  const onExpire = jest.fn();

  await renderHook(() => useExpiryTimer(null, onExpire));
  jest.advanceTimersByTime(10_000);

  expect(onExpire).not.toHaveBeenCalled();
});

it("re-checks the deadline when the app returns to the foreground", async () => {
  const appState = mockAppState();
  const onExpire = jest.fn();
  // Deadline far enough out that the pending setTimeout would not fire on its own within
  // this test, so the only way onExpire is called is via the foreground re-check.
  const dismissAt = Date.now() + 60_000;

  await renderHook(() => useExpiryTimer(dismissAt, onExpire));
  expect(onExpire).not.toHaveBeenCalled();

  // Simulate the deadline having passed while backgrounded, then returning to foreground.
  jest.setSystemTime(dismissAt + 1000);
  appState.emit("active");

  expect(onExpire).toHaveBeenCalledTimes(1);
});

it("does not fire twice for the same deadline", async () => {
  const appState = mockAppState();
  const onExpire = jest.fn();
  const dismissAt = Date.now() + 5000;

  await renderHook(() => useExpiryTimer(dismissAt, onExpire));
  jest.advanceTimersByTime(5000);
  jest.setSystemTime(dismissAt + 1000);
  appState.emit("active");

  expect(onExpire).toHaveBeenCalledTimes(1);
});
