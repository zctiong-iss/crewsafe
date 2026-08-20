import { useEffect, useMemo, useState } from "react";
import {
  subscribeToConcerns,
  type Concern,
  type ConcernStreamStatus,
} from "@/api/concernStream";
import { isConnectionStale } from "./actionMonitoringLogic";

export type ConcernConnectionState = "connecting" | "live" | "degraded" | "closed";

export interface ConcernStreamView {
  concerns: readonly Concern[];
  connectionState: ConcernConnectionState;
  hasSnapshot: boolean;
}

interface SiteConcernState {
  siteId: string;
  concerns: readonly Concern[];
  status: ConcernStreamStatus;
  lastSnapshotAt: number | null;
}

function initialState(siteId: string): SiteConcernState {
  return { siteId, concerns: [], status: "connecting", lastSnapshotAt: null };
}

export function useConcernStream(
  siteId: string,
  subscribe: typeof subscribeToConcerns = subscribeToConcerns,
): ConcernStreamView {
  const [stream, setStream] = useState<SiteConcernState>(() => initialState(siteId));
  const [now, setNow] = useState(() => Date.now());

  // A site change renders an empty connecting state immediately, before the old effect cleanup
  // runs, so one site's safety data is never shown under another site's selector.
  const active = stream.siteId === siteId ? stream : initialState(siteId);

  useEffect(() => {
    setStream(initialState(siteId));
    const unsubscribe = subscribe(siteId, {
      onSnapshot: (next) => {
        setStream((current) =>
          current.siteId === siteId
            ? { ...current, concerns: next, lastSnapshotAt: Date.now() }
            : current,
        );
      },
      onStatus: (status) => {
        setStream((current) =>
          current.siteId === siteId ? { ...current, status } : current,
        );
      },
    });
    return unsubscribe;
  }, [siteId, subscribe]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const connectionState = useMemo<ConcernConnectionState>(() => {
    if (active.status === "closed") return "closed";
    if (active.status === "degraded") return "degraded";
    if (active.lastSnapshotAt === null) return "connecting";
    if (isConnectionStale(active.lastSnapshotAt, now)) return "degraded";
    return "live";
  }, [active, now]);

  return {
    concerns: active.concerns,
    connectionState,
    hasSnapshot: active.lastSnapshotAt !== null,
  };
}
