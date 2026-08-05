/**
 * Polls while the app is in the foreground, regardless of which screen is in front.
 *
 * ── HOW THIS DIFFERS FROM `useAutoRefresh`, AND WHY BOTH EXIST ──────────────────────────
 * `useAutoRefresh` is focus-gated: it runs only while its own screen is showing. That is the
 * right default and the reason is battery — a phone that has to last an outdoor shift should
 * not be fetching weather for a screen nobody is looking at.
 *
 * It is the wrong rule for data that is *visible from somewhere else*. The Alerts tab badge
 * (SCRUM-208) counts outstanding actions and is drawn on the tab bar, so it is on screen
 * while the worker is on My shift, Weather or Profile. Focus-gated polling would leave it
 * showing whatever was true when the worker last opened Alerts — so a newly dispatched
 * action would not appear on the badge until they opened the very screen the badge exists to
 * send them to. The NFR is "visible to an online worker within 60 seconds", and that cannot
 * be met from another tab by a poll that is not running.
 *
 * So this hook drops the focus gate and keeps everything else: it fires immediately on mount,
 * again whenever the app returns to the foreground, and on an interval in between. **Nothing
 * polls while the app is backgrounded** — the battery argument still holds there, and a phone
 * in a pocket has nobody to show a badge to.
 *
 * Use `useAutoRefresh` for a screen's own data. Use this only when something visible from
 * elsewhere depends on the result, and say so at the call site.
 */
import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

export function useForegroundRefresh(callback: () => void, intervalMs: number): void {
  /*
   * Held in a ref so a changing callback identity does not tear down and restart the timer.
   * The callback closes over redux state, so it is a new function after every fetch — as a
   * dependency it would restart the interval on each one and never actually reach it.
   */
  const saved = useRef(callback);
  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  const run = useCallback(() => saved.current(), []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(run, intervalMs);
    };

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onAppStateChange = (state: AppStateStatus) => {
      if (state === "active") {
        // Returning from background: the data is as old as the phone was in a pocket, and
        // the badge is the first thing the worker will look at.
        run();
        start();
      } else {
        stop();
      }
    };

    run();
    start();
    const subscription = AppState.addEventListener("change", onAppStateChange);

    return () => {
      stop();
      // Optional call for parity with the other AppState consumers: a throw inside cleanup
      // aborts unmounting the whole subtree.
      subscription?.remove?.();
    };
  }, [intervalMs, run]);
}
