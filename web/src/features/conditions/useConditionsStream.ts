/** @author Tang Chee Seng (with assistance from Claude) */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchConditionsHistory,
  type ConditionsHistory,
} from "@/api/conditionsHistory";
import {
  subscribeToConditions, type ConditionsSnapshot, type StreamStatus,
} from "@/api/conditionsStream";
import type { ConditionsRangeWarning } from "@/api/conditionsDecoder";
import {
  appendTrendPoint,
  isConnectionStale,
  isStopWorkActive,
  mergeTrendPoints,
  type TrendPoint,
} from "./streamLogic";

export type ConnectionState = "connecting" | "live" | "degraded" | "closed";
export type HistoryState = "loading" | "ready" | "unavailable";
export type ConditionsHistoryLoader = (
  siteId: string,
  signal?: AbortSignal,
) => Promise<ConditionsHistory>;

export interface ConditionsStreamView {
  snapshot: ConditionsSnapshot | null;
  connectionState: ConnectionState;
  trend: TrendPoint[];
  stopWorkActive: boolean;  
  rangeWarnings: ConditionsRangeWarning[];
  historyState: HistoryState;
}

function latestAsOf(current: string | null, candidate: string): string {
  if (current === null || Date.parse(candidate) > Date.parse(current)) return candidate;
  return current;
}

export function useConditionsStream(
  siteId: string,
  subscribe: typeof subscribeToConditions = subscribeToConditions,
  loadHistory: ConditionsHistoryLoader = fetchConditionsHistory,
): ConditionsStreamView {
  const [snapshot, setSnapshot] = useState<ConditionsSnapshot | null>(null);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [lastSnapshotAt, setLastSnapshotAt] = useState<number | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [rangeWarnings, setRangeWarnings] =
    useState<ConditionsRangeWarning[]>([]);
  const [historyState, setHistoryState] = useState<HistoryState>("loading");
  const trendAsOf = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let historyController: AbortController | null = null;

    setSnapshot(null);
    setStatus("connecting");
    setLastSnapshotAt(null);
    setTrend([]);
    setRangeWarnings([]);
    setHistoryState("loading");
    trendAsOf.current = null;

    const unsubscribe = subscribe(siteId, {
      onSnapshot: (next, warnings) => {
        setSnapshot(next);
        setLastSnapshotAt(Date.now());
        setRangeWarnings([...warnings]);
        const asOf = latestAsOf(trendAsOf.current, next.asOf);
        trendAsOf.current = asOf;

        // Do not add an unverified WBGT measurement to the trend chart.
        if (warnings.some((warning) => warning.metric === "wbgt")) {
          setTrend((buffer) => mergeTrendPoints(buffer, [], asOf));
        } else {
          setTrend((buffer) => appendTrendPoint(buffer, { ...next, asOf }));
        }
      },
      onStatus: setStatus,
    });

    const refreshHistory = () => {
      historyController?.abort();
      const requestController = new AbortController();
      historyController = requestController;
      setHistoryState("loading");

      void loadHistory(siteId, requestController.signal)
        .then((history) => {
          if (!active || requestController.signal.aborted) return;
          const asOf = latestAsOf(trendAsOf.current, history.asOf);
          trendAsOf.current = asOf;
          setTrend((buffer) => mergeTrendPoints(history.points, buffer, asOf));
          setHistoryState("ready");
        })
        .catch(() => {
          if (!active || requestController.signal.aborted) return;
          setHistoryState("unavailable");
        });
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshHistory();
    };

    refreshHistory();
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      historyController?.abort();
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      unsubscribe();
    };
  }, [siteId, subscribe, loadHistory]);

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

  return {
    snapshot,
    connectionState,
    trend,
    stopWorkActive,
    rangeWarnings,
    historyState,
  };
}
