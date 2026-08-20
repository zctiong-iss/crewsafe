/** @author Tang Chee Seng (with assistance from Claude) */
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { apiBaseUrl } from "@/auth/authConfig";
import { currentAccessToken } from "./client";
import {
  decodeActionDispatch,
  decodeAlertCount,
  InvalidActionStatusPayloadError,
} from "./actionStatusDecoder";

// The five states a dispatch can hold. CANCELLED is a valid terminal state the stream will
// send, but it is deliberately excluded from the alert counts (server-side) and from the
// display buckets (see actionMonitoringLogic.bucketDispatches).
export type ActionDispatchStatus =
  | "PENDING"
  | "LATE"
  | "ACKNOWLEDGED"
  | "COMPLETED"
  | "CANCELLED";

// Who closed the dispatch out: the worker themselves, or the system on their behalf. Null
// until the dispatch reaches COMPLETED.
export type CompletedBy = "WORKER" | "SYSTEM";

export interface ActionDispatch {
  id: string;
  recommendationId: string;
  approvalId: string | null; // null for an auto-dispatched stop-work
  workerId: string;
  actionCode: string;
  instruction: string | null;
  startTime: string | null;
  endTime: string | null;
  status: ActionDispatchStatus;
  dispatchedAt: string;
  lateAt: string | null; // set once it has ever gone LATE
  completedBy: CompletedBy | null;
}

export interface AlertCounts {
  siteId: string;
  pending: number;
  late: number;
  acknowledged: number;
  completed: number; // excludes CANCELLED — the server never counts a cancelled dispatch
  asOf: string;
}

export type StreamStatus = "connecting" | "live" | "degraded" | "closed";

export interface ActionStatusStreamHandlers {
  /**
   * A whole, committed tick: the complete set of current dispatches plus the matching counts.
   * Only ever called on an `alert-count` event — never mid-tick — so the consumer never sees
   * a partially-received set.
   */
  onTick: (dispatches: readonly ActionDispatch[], counts: AlertCounts) => void;
  onStatus: (status: StreamStatus) => void;
}

class FatalStreamError extends Error {}
class RecycleSignal extends Error {}

const BASE_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

export function subscribeToActionStatus(
  siteId: string,
  handlers: ActionStatusStreamHandlers,
): () => void {
  const controller = new AbortController();
  let attempt = 0;

  // Per-tick buffer. The server sends N `action-status` events then ONE `alert-count`; that
  // `alert-count` is the tick-commit boundary. We accumulate dispatches here until it arrives.
  let buffer: ActionDispatch[] = [];
  // If any `action-status` in the current tick fails to decode, the whole tick is untrustworthy
  // — we drop it rather than commit a partial set, and stay degraded until a clean tick lands.
  let tickPoisoned = false;

  // Custom fetch so EVERY (re)connect carries a FRESH token.
  const authedFetch: typeof fetch = async (input, init) => {
    const token = await currentAccessToken();
    const headers = new Headers(init?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };

  // Fold one `action-status` frame into the current tick's buffer. A frame that fails to
  // decode poisons the whole tick — it is dropped, not committed, at the next boundary.
  function ingestDispatch(data: string): void {
    try {
      const dispatch = decodeActionDispatch(data);
      if (!tickPoisoned) buffer.push(dispatch);
    } catch (error) {
      if (error instanceof InvalidActionStatusPayloadError) {
        handlers.onStatus("degraded");
        tickPoisoned = true; // committed only once a clean tick follows
        return;
      }
      throw error;
    }
  }

  // Close out a tick on its `alert-count` boundary: commit the buffered set only if both it
  // and the counts are clean, otherwise drop it and degrade. Either way the buffer resets for
  // the next tick — `alert-count` is the only signal that one tick ends and the next begins.
  function commitTick(data: string): void {
    let counts: AlertCounts | null = null;
    try {
      counts = decodeAlertCount(data);
    } catch (error) {
      if (!(error instanceof InvalidActionStatusPayloadError)) throw error;
      // counts stays null → treated exactly like a poisoned tick below
    }

    if (counts !== null && !tickPoisoned) {
      handlers.onStatus("live");
      handlers.onTick(buffer, counts);
    } else {
      handlers.onStatus("degraded");
    }

    buffer = [];
    tickPoisoned = false;
  }

  handlers.onStatus("connecting");

  void fetchEventSource(`${apiBaseUrl}/api/v1/sites/${siteId}/actions/stream`, {
    fetch: authedFetch,
    signal: controller.signal,
    openWhenHidden: true,
    async onopen(response) {
      const contentType = response.headers.get("content-type") ?? "";
      if (response.ok && contentType.includes("text/event-stream")) {
        attempt = 0;
        handlers.onStatus("live");
        return;
      }
      if (response.status === 401 || response.status === 403) {
        throw new FatalStreamError(`auth ${response.status}`);
      }
      throw new Error(`unexpected ${response.status}`);
    },
    onmessage(ev) {
      if (ev.data === "") return;
      if (ev.event === "action-status") ingestDispatch(ev.data);
      else if (ev.event === "alert-count") commitTick(ev.data);
      // Any other event type is not part of the contract — ignore it.
    },
    onclose() {
      // Server recycles every 5 min. The library STOPS on a clean close unless we throw.
      throw new RecycleSignal();
    },
    onerror(err) {
      if (err instanceof FatalStreamError) {
        handlers.onStatus("closed");
        throw err;
      }
      if (err instanceof RecycleSignal) {
        handlers.onStatus("connecting");
        return 500;
      }
      handlers.onStatus("degraded");
      const delay = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** attempt);
      attempt += 1;
      return delay;
    },
  }).catch(() => {
    // Reached only when onerror threw (fatal). Status is already "closed".
  });

  return () => controller.abort();
}
