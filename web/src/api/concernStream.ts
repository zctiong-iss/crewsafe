import { fetchEventSource } from "@microsoft/fetch-event-source";
import { apiBaseUrl } from "@/auth/authConfig";
import { currentAccessToken } from "./client";
import { decodeConcernSnapshot, InvalidConcernPayloadError } from "./concernDecoder";

export type ConcernStatus = "OPEN";
export type ConcernSymptom =
  | "NONE"
  | "DIZZINESS"
  | "NAUSEA"
  | "HEADACHE"
  | "FATIGUE"
  | "MUSCLE_CRAMPS"
  | "OTHER";

export interface Concern {
  id: string;
  shiftId: string;
  workerId: string;
  symptoms: ConcernSymptom[];
  note: string | null;
  status: ConcernStatus;
  raisedAt: string;
  acknowledgedAt: string | null;
}

export type ConcernStreamStatus = "connecting" | "live" | "degraded" | "closed";

export interface ConcernStreamHandlers {
  onSnapshot: (concerns: readonly Concern[]) => void;
  onStatus: (status: ConcernStreamStatus) => void;
}

class FatalStreamError extends Error {}
class RecycleSignal extends Error {}

const BASE_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

export function subscribeToConcerns(
  siteId: string,
  handlers: ConcernStreamHandlers,
): () => void {
  const controller = new AbortController();
  let attempt = 0;

  const authedFetch: typeof fetch = async (input, init) => {
    const token = await currentAccessToken();
    const headers = new Headers(init?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };

  handlers.onStatus("connecting");

  void fetchEventSource(`${apiBaseUrl}/api/v1/sites/${siteId}/concerns/stream`, {
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
        handlers.onStatus("closed");
        throw new FatalStreamError(`auth ${response.status}`);
      }
      throw new Error(`unexpected ${response.status}`);
    },
    onmessage(event) {
      if (event.event !== "concerns" || event.data === "") return;
      try {
        handlers.onSnapshot(decodeConcernSnapshot(event.data));
        handlers.onStatus("live");
      } catch (error) {
        if (error instanceof InvalidConcernPayloadError) {
          handlers.onStatus("degraded");
          return;
        }
        throw error;
      }
    },
    onclose() {
      throw new RecycleSignal();
    },
    onerror(error) {
      if (error instanceof FatalStreamError) {
        handlers.onStatus("closed");
        throw error;
      }
      if (error instanceof RecycleSignal) {
        handlers.onStatus("connecting");
        return 500;
      }
      handlers.onStatus("degraded");
      const delay = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** attempt);
      attempt += 1;
      return delay;
    },
  }).catch(() => {
    // Fatal status is already reported as closed; aborts are intentionally silent.
  });

  return () => controller.abort();
}
