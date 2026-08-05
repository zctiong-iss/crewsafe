/**
 * The badge's poll (SCRUM-208).
 *
 * This hook exists because the focus-gated `useAutoRefresh` cannot keep a tab badge current
 * from another tab. The assertions below are the properties that make it usable for that:
 * it fires immediately, it keeps firing, it stops when the app is backgrounded, and a
 * changing callback identity does not restart it.
 */
// `renderHook` is asynchronous in React Native Testing Library 14 — it returns a promise of
// `{ result, rerender, unmount }`. Forgetting the await yields a promise whose `result` is
// undefined and whose effects have not run, which reads like the hook doing nothing.
import { renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";
import { useForegroundRefresh } from "./useForegroundRefresh";

type AppStateHandler = (state: string) => void;

/** Captures the AppState listener so a background/foreground cycle can be driven. */
function mockAppState() {
  const handlers: AppStateHandler[] = [];
  const remove = jest.fn();
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_event: string, handler: AppStateHandler) => {
    handlers.push(handler as AppStateHandler);
    return { remove } as never;
  }) as never);
  return {
    emit: (state: string) => handlers.forEach((h) => h(state)),
    remove,
  };
}

describe("useForegroundRefresh", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("fires immediately, so the badge is right on the first frame", async () => {
    mockAppState();
    const callback = jest.fn();
    await renderHook(() => useForegroundRefresh(callback, 30_000));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("keeps firing on the interval", async () => {
    mockAppState();
    const callback = jest.fn();
    await renderHook(() => useForegroundRefresh(callback, 30_000));

    jest.advanceTimersByTime(90_000);
    // 1 immediate + 3 interval
    expect(callback).toHaveBeenCalledTimes(4);
  });

  it("stops polling when the app goes to the background", async () => {
    // The battery argument still holds there, and a phone in a pocket has nobody to show a
    // badge to.
    const appState = mockAppState();
    const callback = jest.fn();
    await renderHook(() => useForegroundRefresh(callback, 30_000));
    callback.mockClear();

    appState.emit("background");
    jest.advanceTimersByTime(120_000);
    expect(callback).not.toHaveBeenCalled();
  });

  it("fires at once on return to the foreground, then resumes", async () => {
    const appState = mockAppState();
    const callback = jest.fn();
    await renderHook(() => useForegroundRefresh(callback, 30_000));

    appState.emit("background");
    callback.mockClear();

    appState.emit("active");
    expect(callback).toHaveBeenCalledTimes(1); // immediate catch-up

    jest.advanceTimersByTime(30_000);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  /*
   * The regression this guards against is subtle and total: callers pass an inline arrow, so
   * the callback is a new function every render. If it were an effect dependency the interval
   * would be torn down and rebuilt on each one — and a poll that restarts before it elapses
   * never fires at all.
   */
  it("does not restart the interval when the callback identity changes", async () => {
    mockAppState();
    const calls: string[] = [];
    const { rerender } = await renderHook(
      ({ tag }: { tag: string }) =>
        useForegroundRefresh(() => calls.push(tag), 30_000),
      { initialProps: { tag: "first" } },
    );

    jest.advanceTimersByTime(20_000); // not yet due
    await rerender({ tag: "second" });
    jest.advanceTimersByTime(10_000); // 30s since mount

    // Fired on schedule despite the re-render, and used the latest callback.
    expect(calls).toEqual(["first", "second"]);
  });

  it("clears the timer and the listener on unmount", async () => {
    const appState = mockAppState();
    const callback = jest.fn();
    const { unmount } = await renderHook(() => useForegroundRefresh(callback, 30_000));

    await unmount();
    callback.mockClear();
    jest.advanceTimersByTime(120_000);

    expect(callback).not.toHaveBeenCalled();
    expect(appState.remove).toHaveBeenCalled();
  });
});
