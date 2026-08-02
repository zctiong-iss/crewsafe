/**
 * Keeps a screen's data current without the worker having to think about it.
 *
 * ── WHY THIS IS NOT OPTIONAL ────────────────────────────────────────────────────────────
 * Every screen so far fetched once on mount and then never again. On a safety app that is a
 * defect, not a missing nicety:
 *
 *   • A lightning stop-work warning expires and the banner correctly stops shouting — but
 *     nothing ever asks the server whether a *new* assessment has been issued. The worker
 *     would sit on "expired" through an entire second storm.
 *   • The NEA ingestion writes a new observation every 15 minutes
 *     (`WEATHER_INGESTION_INTERVAL`). A screen opened at the start of a shift would still be
 *     showing the first reading hours later.
 *   • The NFR for dispatched actions is "visible to an online worker within 60 seconds".
 *     Mount-only fetching cannot meet a latency requirement at all.
 *
 * ── WHY IT IS FOCUS AND FOREGROUND AWARE ────────────────────────────────────────────────
 * Polling a screen nobody is looking at spends battery on a phone that has to last a shift
 * outdoors. The timer runs only while this screen is focused *and* the app is active, and
 * it fires immediately on both — so returning to a tab or unlocking the phone shows fresh
 * data rather than whatever was on screen when you left.
 *
 * The callback should request a normal (non-pull-to-refresh) load. The slices leave the UI
 * untouched when they already have data, so a background poll updates the numbers without
 * flashing a spinner over them.
 */
import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

export function useAutoRefresh(callback: () => void, intervalMs: number): void {
  // Held in a ref so a changing callback identity does not tear down and restart the timer
  // — which, with a callback that depends on redux state, would mean restarting it on
  // every fetch and never actually reaching the interval.
  const saved = useRef(callback);

  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useFocusEffect(
    useCallback(() => {
      let timer: ReturnType<typeof setInterval> | null = null;

      const start = () => {
        if (timer !== null) return;
        timer = setInterval(() => saved.current(), intervalMs);
      };

      const stop = () => {
        if (timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };

      const onAppStateChange = (state: AppStateStatus) => {
        if (state === "active") {
          // Resuming from background: the data is as old as the phone was in a pocket.
          saved.current();
          start();
        } else {
          stop();
        }
      };

      saved.current();
      start();

      const subscription = AppState.addEventListener("change", onAppStateChange);

      return () => {
        stop();
        subscription.remove();
      };
    }, [intervalMs]),
  );
}

/**
 * Poll intervals, each tied to something in the plan rather than picked by feel.
 *
 * SHIFT is the shortest of the safety reads because it carries the lightning state, and a
 * stop-work assessment going stale is the one case where a minute matters. WEATHER is
 * loose because the ingestion behind it only writes every 15 minutes — polling faster
 * cannot produce a newer number, it just costs battery.
 */
export const REFRESH_INTERVALS = {
  /** NFR: an approved action must reach an online worker within 60 seconds. */
  INBOX_MS: 30_000,
  /** Carries the lightning risk state and its validity window. */
  SHIFT_MS: 60_000,
  /** `WEATHER_INGESTION_INTERVAL` defaults to 15m; a third of that bounds staleness. */
  WEATHER_MS: 5 * 60_000,
} as const;
