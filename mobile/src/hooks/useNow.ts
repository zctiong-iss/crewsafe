/**
 * A clock that re-renders its component on a fixed interval.
 *
 * SCRUM-172 requires the stop-work banner to clear when its validity window lapses. A
 * window that is only evaluated at fetch time never lapses on screen: a worker holding a
 * phone that says STOP WORK would keep being told to stop long after the warning expired,
 * and would learn to distrust the banner. So the passage of time has to be an input to
 * rendering, not just to fetching.
 *
 * Use this in the smallest component that needs it. Called high in a tree it re-renders
 * everything below on every tick; called inside the banner it re-renders the banner.
 */
import { useEffect, useState } from "react";

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
