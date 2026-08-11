/**
 * Rest, hydration and concerns (US-11).
 *
 * Two audiences, two shapes of URL, and the difference is the point:
 *
 *   POST /api/v1/shifts/{shiftId}/wellbeing-logs   worker, about themselves — no workerId anywhere
 *   POST /api/v1/shifts/{shiftId}/concerns         worker, about themselves
 *   GET  /api/v1/sites/{siteId}/shifts/{id}/wellbeing   supervisor, about the crew
 *   GET  /api/v1/sites/{siteId}/concerns                supervisor, across the site
 *
 * The worker paths carry no site and no worker id: the subject is the token holder, so there is
 * no field through which one worker could log rest for another. The supervisor paths are
 * site-scoped and role-gated like every other supervisor surface.
 *
 * @author Justin Chua
 */
import { request } from "../client";
import { isMockApi } from "@/auth/authMode";
import {
  mockAcknowledgeConcern,
  mockCrewWellbeing,
  mockLogWellbeing,
  mockRaiseConcern,
  mockSiteConcerns,
} from "../mock/wellbeing";
import type {
  Concern,
  CrewWellbeingRow,
  SymptomFlag,
  WellbeingLog,
  WellbeingLogType,
} from "@/types/domain";

const MOCK_LATENCY_MS = 350;

function delay<T>(produce: () => T): Promise<T> {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(produce());
      } catch (error) {
        reject(error);
      }
    }, MOCK_LATENCY_MS),
  );
}

/** `POST /api/v1/shifts/{shiftId}/wellbeing-logs` — 201, because each log is a new fact. */
export function logWellbeing(shiftId: string, logType: WellbeingLogType): Promise<WellbeingLog> {
  if (isMockApi()) return delay(() => mockLogWellbeing(shiftId, logType));
  return request<WellbeingLog>({
    url: `/api/v1/shifts/${shiftId}/wellbeing-logs`,
    method: "POST",
    data: { logType },
  });
}

export interface ConcernInput {
  symptoms: SymptomFlag[];
  /** Optional by contract — the chips carry the meaning that survives translation. */
  note?: string;
}

/** `POST /api/v1/shifts/{shiftId}/concerns`. */
export function raiseConcern(shiftId: string, input: ConcernInput): Promise<Concern> {
  if (isMockApi()) return delay(() => mockRaiseConcern(shiftId, input));
  return request<Concern>({
    url: `/api/v1/shifts/${shiftId}/concerns`,
    method: "POST",
    data: input,
  });
}

/** `GET /api/v1/sites/{siteId}/shifts/{shiftId}/wellbeing` — latest rest and drink per worker. */
export function fetchCrewWellbeing(siteId: string, shiftId: string): Promise<CrewWellbeingRow[]> {
  if (isMockApi()) return delay(() => mockCrewWellbeing(shiftId));
  return request<CrewWellbeingRow[]>({
    url: `/api/v1/sites/${siteId}/shifts/${shiftId}/wellbeing`,
    method: "GET",
  });
}

/** `GET /api/v1/sites/{siteId}/concerns` — every concern across the site's shifts, newest first. */
export function fetchSiteConcerns(siteId: string): Promise<Concern[]> {
  if (isMockApi()) return delay(() => mockSiteConcerns());
  return request<Concern[]>({ url: `/api/v1/sites/${siteId}/concerns`, method: "GET" });
}

/**
 * `POST /api/v1/sites/{siteId}/concerns/{concernId}/acknowledge`.
 *
 * Answers 409 when someone acknowledged first. That is not a race to paper over: the useful fact
 * is who responded, and the second caller genuinely did lose.
 */
export function acknowledgeConcern(siteId: string, concernId: string): Promise<Concern> {
  if (isMockApi()) return delay(() => mockAcknowledgeConcern(concernId));
  return request<Concern>({
    url: `/api/v1/sites/${siteId}/concerns/${concernId}/acknowledge`,
    method: "POST",
  });
}
