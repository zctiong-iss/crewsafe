/** @author Tang Chee Seng (with assistance from Claude and ChatGPT) */
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { apiBaseUrl } from "@/auth/authConfig";
import { currentAccessToken } from "./client";
import {
  decodeConditionsSnapshot,
  InvalidConditionsPayloadError,
  type ConditionsRangeWarning,
} from "./conditionsDecoder";

export type WeatherSource = "NEA" | "MANUAL" | "CACHED";
export type WeatherFreshness = "LIVE" | "DELAYED" | "STALE" | "SIMULATED";

export interface ConditionsPayload {
  wbgt: number; temperature: number; humidity: number;
  windSpeed: number; rainfall: number;
  observedAt: string; source: WeatherSource; freshness: WeatherFreshness;
}

export type LightningRiskState = "CLEAR" | "ADVISORY" | "STOP_WORK";

export interface LightningRiskPayload {
  state: LightningRiskState;
  nearestStrikeKm: number;
  observedAt: string;
  validUntil: string;
  freshness: WeatherFreshness;
}

export interface ActiveShiftPayload {
  shiftId: string;
  startsAt: string;
  endsAt: string;
}

export interface ConditionsSnapshot {
  siteId: string;
  conditions: ConditionsPayload | null;
  lightning: LightningRiskPayload | null;
  activeShift: ActiveShiftPayload | null;
  asOf: string;
}

export type StreamStatus = "connecting" | "live" | "degraded" | "closed";

export interface ConditionsStreamHandlers {
  onSnapshot: (
    snapshot: ConditionsSnapshot,
    warnings: readonly ConditionsRangeWarning[],
  ) => void;
  onStatus: (status: StreamStatus) => void;
}

class FatalStreamError extends Error {}
class RecycleSignal extends Error {}

const BASE_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

export function subscribeToConditions(
  siteId: string,
  handlers: ConditionsStreamHandlers,
): () => void {
  const controller = new AbortController();
  let attempt = 0;

  // Custom fetch so EVERY (re)connect carries a FRESH token.
  const authedFetch: typeof fetch = async (input, init) => {
    const token = await currentAccessToken();
    const headers = new Headers(init?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };

  handlers.onStatus("connecting");

  void fetchEventSource(`${apiBaseUrl}/api/v1/sites/${siteId}/conditions/stream`, {
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
      if (ev.event !== "conditions" || ev.data === "") return;
      try {
        const decoded = decodeConditionsSnapshot(ev.data);
        handlers.onStatus("live");
        handlers.onSnapshot(decoded.snapshot, decoded.warnings);
      } catch (error) {
        if (error instanceof InvalidConditionsPayloadError) {
          handlers.onStatus("degraded");
          return;
        }
        throw error;
      }
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
