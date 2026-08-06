/**
 * The worker home screen's data.
 *
 * Every function here has the same shape: the real request, written out and commented, next
 * to the mock that currently answers it. Switching to the real backend is deleting a
 * branch, not rewriting a call site — the screens above never learn which one ran.
 *
 * Only `fetchMyShift` is still mocked unconditionally: `GET /api/v1/shifts/me` exists on no
 * deployment. `fetchSiteWeather` (SCRUM-209) and `fetchLightningRisk` (SCRUM-261) both branch
 * on the auth mode like `identity.ts` and `sites.ts` do, because the endpoints they need are
 * real.
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
import { getLightningSource } from "../mock/scenario";
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
 * `GET /api/v1/sites/{siteId}/lightning` — real since SCRUM-261.
 *
 * ── NULL MEANS "NO DATA", AND MUST NEVER BECOME "CLEAR" ─────────────────────────────────
 * A 404 is the server saying it has never ingested lightning for this site — the scheduler
 * is off, or the site is new. That is returned as `null` and the screen says so.
 *
 * It is emphatically not `CLEAR`. Those two render as the same absence of a warning while
 * meaning opposite things, and a crew told everything is fine because a scheduler was
 * switched off is the failure this endpoint was added to prevent. The backend models the
 * same distinction as an empty `Optional`; this preserves it rather than defaulting.
 *
 * ── WHICH SOURCE ────────────────────────────────────────────────────────────────────────
 * `mock` auth mode has no network, so it is always the fixture. Outside it the default is
 * live, and `getLightningSource()` lets a reviewer force the fixture to exercise all three
 * states on a clear day. Anything other than mock mode plus an explicit `simulated` choice
 * returns the server's answer and nothing else.
 */
export async function fetchLightningRisk(siteId: string): Promise<LightningRisk | null> {
  if (isMockApi() || getLightningSource() === "simulated") {
    return delay(mockLightningRisk(siteId));
  }

  try {
    return await request<LightningRisk>({
      url: `/api/v1/sites/${siteId}/lightning`,
      method: "GET",
    });
  } catch (error) {
    if (isApiError(error) && error.kind === "not-found") {
      return null;
    }
    throw error;
  }
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
