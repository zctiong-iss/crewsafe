/** @author Tang Chee Seng (with assistance from Claude) */
import { useEffect, useMemo, useState } from "react";
import {
  subscribeToConditions, type ConditionsSnapshot, type StreamStatus,
} from "@/api/conditionsStream";
import { appendTrendPoint, isConnectionStale, isStopWorkActive, type TrendPoint } from "./streamLogic";

const TREND_CAP = 60;
export type ConnectionState = "connecting" | "live" | "degraded" | "closed";

export interface ConditionsStreamView {
  snapshot: ConditionsSnapshot | null;
  connectionState: ConnectionState;
  trend: TrendPoint[];
  stopWorkActive: boolean;  
}

export function useConditionsStream(
  siteId: string,
  subscribe: typeof subscribeToConditions = subscribeToConditions,
): ConditionsStreamView {
  const [snapshot, setSnapshot] = useState<ConditionsSnapshot | null>(null);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [lastSnapshotAt, setLastSnapshotAt] = useState<number | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const unsubscribe = subscribe(siteId, {
      onSnapshot: (next) => {
        setSnapshot(next);
        setLastSnapshotAt(Date.now());
        setTrend((buffer) => appendTrendPoint(buffer, next, TREND_CAP));
      },
      onStatus: setStatus,
    });
    return unsubscribe;
  }, [siteId, subscribe]);

  // ⟵ YOU: the watchdog tick — triggers re-render so useMemo rechecks staleness
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const connectionState = useMemo<ConnectionState>(() => {
    if (status === "closed") return "closed";
    if (lastSnapshotAt === null) return "connecting";
    if (status === "degraded" || isConnectionStale(lastSnapshotAt, now)) return "degraded";
    return "live";
  }, [status, lastSnapshotAt, now]);

  const stopWorkActive = useMemo(
  () => isStopWorkActive(snapshot?.lightning ?? null, now),
  [snapshot?.lightning, now],
);

  return { snapshot, connectionState, trend, stopWorkActive };
}