/**
 * The worker home screen's data.
 *
 * Every function here has the same shape: the real request, written out and commented, next
 * to the mock that currently answers it. Switching to the real backend is deleting a
 * branch, not rewriting a call site — the screens above never learn which one ran.
 *
 * The shift and lightning calls are mocked unconditionally — not just in `mock` auth mode —
 * because no deployment exposes those endpoints at all. `fetchSiteWeather` is no longer in
 * that group: since SCRUM-209 it branches on the auth mode like `identity.ts` and
 * `sites.ts` do, because the endpoint it needs is real.
 */
import type {
  LightningRisk,
  MyShift,
  PolicyEvaluation,
  SiteConditions,
  WbgtBand,
} from "@/types/domain";
import { request } from "../client";
import { isMockApi } from "@/auth/authMode";
import { isApiError } from "../errors";
import { mockLightningRisk } from "../mock/lightning";
import { mockConditions } from "../mock/conditions";
import { mockMyShift } from "../mock/myShift";

/** Simulates a round trip, so loading states are visible rather than theoretical. */
const MOCK_LATENCY_MS = 350;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), MOCK_LATENCY_MS));
}

/**
 * `GET /api/v1/shifts/me` — SCRUM-162, contract in `docs/api/shift-readiness.yaml`.
 *
 * Real implementation:
 *   return request<MyShiftResponse>({ url: "/api/v1/shifts/me", method: "GET" });
 *
 * Returns null when the worker has no current or upcoming shift — a legitimate answer, not
 * an error, and the screen has an empty state for it.
 */
export function fetchMyShift(): Promise<MyShift | null> {
  return delay(mockMyShift());
}

/**
 * `GET /api/v1/sites/{siteId}/lightning` — SCRUM-170, blocking SCRUM-172.
 *
 * Real implementation:
 *   return request<LightningRisk>({ url: `/api/v1/sites/${siteId}/lightning`, method: "GET" });
 *
 * See `api/mock/lightning.ts` for the full response shape this commits to and why
 * `validUntil` has to come from the server.
 */
export function fetchLightningRisk(siteId: string): Promise<LightningRisk> {
  return delay(mockLightningRisk(siteId));
}

export interface SiteConditionsResponse {
  observation: SiteConditions;
  policy: PolicyEvaluation;
}

/**
 * `GET /api/v1/sites/{siteId}/conditions` — §12.1 of the project plan.
 *
 * Real implementation:
 *   return request<SiteConditionsResponse>({
 *     url: `/api/v1/sites/${siteId}/conditions`, method: "GET",
 *   });
 *
 * `intensity` and `workerId` are arguments only because the mock evaluates policy locally.
 * The real endpoint derives both server-side from the caller's assignment — a client that
 * could name its own intensity could choose its own heat-rest obligation.
 */
export function fetchSiteConditions(
  siteId: string,
  intensity: MyShift["assignment"]["intensity"],
  workerId: string,
): Promise<SiteConditionsResponse> {
  return delay(mockConditions(siteId, intensity, workerId));
}

/**
 * A reading and the band it falls into — everything the weather screen shows, and nothing
 * it does not.
 *
 * Both are nullable, and for different reasons. `observation` is null when the site has no
 * stored reading yet; `band` is null when the reading exists but its WBGT could not be
 * derived. Collapsing either into a default would make "we do not know" look like a fact.
 */
export interface SiteWeatherResponse {
  observation: SiteConditions | null;
  band: WbgtBand | null;
}

/** The wire shape of `GET /api/v1/sites/{siteId}/weather/latest`. */
interface LatestWeatherWire extends SiteConditions {
  /** The observation row's own id. Nothing on the client needs it. */
  id: string;
  band: WbgtBand | null;
}

/**
 * `GET /api/v1/sites/{siteId}/weather/latest` — real, and live outside mock mode since
 * SCRUM-209.
 *
 * The band comes down evaluated. The client must never derive it: §12.2 forbids a client
 * submitting or overriding a WBGT risk band, and FR-15 makes the backend engine
 * authoritative for anything that decides what a worker must do. `api/mock/conditions.ts`
 * still contains that arithmetic and still keeps it out of `src/helpers/` for exactly this
 * reason — it is a stand-in server, not a utility.
 *
 * `workerId` is a mock-only argument, kept because `mockConditions` evaluates a whole
 * policy locally and needs someone to attribute the actions to. This function discards
 * that policy: the weather screen shows a reading for a site, not one worker's
 * obligations, which is why intensity is not a parameter here at all.
 *
 * A 404 is not an error. It is the backend saying this site has nothing ingested yet —
 * true for a newly created site, and a state the screen has to render rather than blame
 * the network for.
 */
export async function fetchSiteWeather(
  siteId: string,
  workerId: string,
): Promise<SiteWeatherResponse> {
  if (isMockApi()) {
    const mock = await delay(mockConditions(siteId, "MODERATE", workerId));
    return { observation: mock.observation, band: mock.policy.currentBand };
  }

  try {
    const wire = await request<LatestWeatherWire>({
      url: `/api/v1/sites/${siteId}/weather/latest`,
      method: "GET",
    });

    // Destructured apart rather than passed through whole: `id` and `band` are not part of
    // `SiteConditions`, and a spread would smuggle both into it.
    const { id: _id, band, ...observation } = wire;
    return { observation, band };
  } catch (error) {
    if (isApiError(error) && error.kind === "not-found") {
      return { observation: null, band: null };
    }
    throw error;
  }
}
