/** @author Tang Chee Seng (with assistance from Claude) */
import { useEffect, useMemo, useState } from "react";
import {
  subscribeToActionStatus,
  type ActionDispatch,
  type AlertCounts,
  type StreamStatus,
} from "@/api/actionStatusStream";
import { isConnectionStale } from "./actionMonitoringLogic";

export type ConnectionState = "connecting" | "live" | "degraded" | "closed";

export interface ActionMonitoringView {
  dispatches: readonly ActionDispatch[];
  counts: AlertCounts | null;
  connectionState: ConnectionState;
}

export function useActionStatusStream(
  siteId: string,
  subscribe: typeof subscribeToActionStatus = subscribeToActionStatus,
): ActionMonitoringView {
  // Each tick replaces the whole set — the server sends the complete list of current
  // dispatches every tick, not a delta, so there is nothing to merge across ticks.
  const [dispatches, setDispatches] = useState<readonly ActionDispatch[]>([]);
  const [counts, setCounts] = useState<AlertCounts | null>(null);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const unsubscribe = subscribe(siteId, {
      onTick: (nextDispatches, nextCounts) => {
        setDispatches(nextDispatches);
        setCounts(nextCounts);
        setLastTickAt(Date.now());
      },
      onStatus: setStatus,
    });
    return unsubscribe;
  }, [siteId, subscribe]);

  // Watchdog tick — a re-render each second so useMemo re-checks staleness even when no
  // frames are arriving (a silently-wedged connection still goes degraded).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const connectionState = useMemo<ConnectionState>(() => {
    if (status === "closed") return "closed";
    if (lastTickAt === null) return "connecting";
    if (status === "degraded" || isConnectionStale(lastTickAt, now)) return "degraded";
    return "live";
  }, [status, lastTickAt, now]);

  return { dispatches, counts, connectionState };
}
