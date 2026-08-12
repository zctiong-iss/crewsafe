/**
 * Domain types mirrored from the backend. Each block names the Java record or OpenAPI
 * schema it must stay in step with, so a contract change has an obvious landing site.
 *
 * @author Justin Chua
 */

/** Mirrors `identity/domain/Role.java`. Stored without Spring's `ROLE_` prefix. */
export type Role = "WORKER" | "SUPERVISOR" | "SAFETY_MANAGER" | "ADMIN";

/** Mirrors `identity/api/MeResponse.java` — `GET /api/v1/me`. */
export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  siteIds: string[];
}

/** Mirrors `site/api/SiteController.SiteResponse` — `GET /api/v1/sites`. */
export interface Site {
  id: string;
  name: string;
  latitude: string;
  longitude: string;
  timezone: string;
}

/** Mirrors `SiteController.SiteWorkerResponse` — `GET /api/v1/sites/{siteId}/workers`. */
export interface SiteWorker {
  id: string;
  displayName: string;
}

/** Mirrors the `Intensity` schema in `docs/api/shift.yaml`. Fixed set — never free text. */
export type Intensity = "LIGHT" | "MODERATE" | "HEAVY";

/** Mirrors `ShiftStatus`. Server-controlled: a client cannot set it. */
export type ShiftStatus = "PLANNED" | "ACTIVE" | "CLOSED";

/** Mirrors the `ShiftAssignment` schema in `docs/api/shift.yaml`. */
export interface ShiftAssignment {
  id: string;
  workerId: string;
  taskName: string | null;
  intensity: Intensity;
  /** Which of the 7 ramp-up days. Null for a fully acclimatised worker. */
  acclimatisationDay: number | null;
}

/** Mirrors the `Shift` schema in `docs/api/shift.yaml`. */
export interface Shift {
  id: string;
  siteId: string;
  /** ISO 8601, UTC. */
  startsAt: string;
  endsAt: string;
  status: ShiftStatus;
  assignments: ShiftAssignment[];
}

/** Mirrors `operation/api/ActionDispatchResponse.java`. */
export type ActionDispatchStatus = "PENDING" | "ACKNOWLEDGED" | "COMPLETED";

export interface ActionDispatch {
  id: string;
  approvalId: string;
  workerId: string;
  /** Open catalogue, not an enum: REST_10_MIN, REST_15_MIN, HYDRATE, STOP_WORK, ... */
  actionCode: string;
  instruction: string | null;
  startTime: string | null;
  endTime: string | null;
  status: ActionDispatchStatus;
  dispatchedAt: string;
}

/**
 * Lightning risk state (SCRUM-170 / FR-10a).
 *
 * NOT YET IMPLEMENTED SERVER-SIDE — there is no lightning ingestion, no risk classifier and
 * no endpoint in the backend today. This type is the contract the mobile banner (SCRUM-172)
 * is built against, and `src/api/mock/lightning.ts` is what currently satisfies it. See
 * that file for the endpoint this needs to become real.
 */
export type LightningRiskState = "CLEAR" | "ADVISORY" | "STOP_WORK";

export interface LightningRisk {
  siteId: string;
  state: LightningRiskState;
  /** Kilometres to the nearest observed strike, per §13.1 of the project plan. */
  nearestStrikeKm: number | null;
  observedAt: string;
  /** The banner clears itself when this passes — the "expired" half of SCRUM-172. */
  validUntil: string;
  /**
   * How current the underlying NEA feed is, when the server said (SCRUM-261).
   *
   * Optional because the mock does not produce one: a simulated state has no feed behind it,
   * and inventing a `LIVE` for it would be the one lie this whole toggle exists to avoid.
   */
  freshness?: WeatherQualityStatus;
}

/**
 * Site conditions (FR-10 to FR-12).
 *
 * PARTIALLY IMPLEMENTED SERVER-SIDE: `weather_observation` is populated by the NEA
 * ingestion scheduler, but no controller exposes it. `GET /sites/{siteId}/conditions` is
 * specified in §12.1 of the project plan and does not exist yet. See
 * `src/api/mock/weather.ts`.
 */
export type WeatherQualityStatus = "LIVE" | "DELAYED" | "STALE" | "SIMULATED";
export type WeatherSource = "NEA" | "MANUAL" | "CACHED";

export interface SiteConditions {
  siteId: string;
  /** Wet-bulb globe temperature, °C. Null when the reading could not be derived. */
  wbgt: number | null;
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  rainfall: number | null;
  observedAt: string;
  ingestedAt: string;
  source: WeatherSource;
  qualityStatus: WeatherQualityStatus;
  stationId: string | null;
}

/**
 * A presentational weather category, for choosing an icon.
 *
 * Not a backend concept and deliberately not a safety one. The NEA ingestion stores numeric
 * metrics — WBGT, air temperature, humidity, wind, rainfall — and no textual forecast, so
 * this is derived in the app (see `helpers/weather.ts`). That is allowed here for the
 * reason it is *not* allowed for WBGT bands: nothing acts on it. It picks a picture. The
 * WBGT band, which decides whether someone must rest, stays server-side per FR-15.
 */
export type WeatherCondition =
  | "FAIR"
  | "PARTLY_CLOUDY"
  | "CLOUDY"
  | "WINDY"
  | "RAIN"
  | "THUNDERY_SHOWERS";

/**
 * The deterministic policy engine's verdict (FR-15, §7.2 of the project plan).
 *
 * NOT IMPLEMENTED SERVER-SIDE. The band boundaries live in the engine, not here: FR-15
 * makes the backend authoritative and §12.2 states plainly that no client may submit or
 * override a WBGT risk band. So the app renders this and never derives it — the arithmetic
 * that produces it in development lives in `api/mock/conditions.ts`, standing in for the
 * server, deliberately not in a helper the UI could start calling directly.
 */
export type WbgtBand = "BELOW_31" | "31_TO_BELOW_32" | "32_TO_BELOW_33" | "33_AND_ABOVE";

export interface PolicyAction {
  /** e.g. REST_10_MIN_HOURLY, HYDRATE_HOURLY, RESCHEDULE_HEAVY_WORK. Open catalogue. */
  code: string;
  /** Worker ids this applies to. */
  appliesTo: string[];
  /** The rule that produced it, e.g. "HS-32-HEAVY". Required by FR-16. */
  ruleReference: string;
}

export interface PolicyEvaluation {
  policyVersion: string;
  currentBand: WbgtBand;
  forecastBand: WbgtBand | null;
  mandatoryActions: PolicyAction[];
  advisoryActions: PolicyAction[];
}

/* ----------------------- The caller's own shift (SCRUM-162) ----------------------- */

/** Mirrors `MyShiftAssignmentView` in `docs/api/shift-readiness.yaml`. */
export interface MyShiftAssignment {
  taskName: string | null;
  intensity: Intensity;
  acclimatisationDay: number | null;
}

/**
 * Mirrors the non-null `shift` branch of `MyShiftResponse` in
 * `docs/api/shift-readiness.yaml`.
 *
 * CONTRACT EXISTS, ENDPOINT DOES NOT: `GET /api/v1/shifts/me` is fully specified but no
 * controller implements it — see `api/mock/myShift.ts`.
 */
export interface MyShift {
  shiftId: string;
  siteId: string;
  startsAt: string;
  endsAt: string;
  status: ShiftStatus;
  assignment: MyShiftAssignment;
}

/**
 * The action codes a mitigation may carry — mirrors `mitigation/domain/ActionCatalogue.java`
 * (SCRUM-119).
 *
 * Typed as a union rather than `string` so that adding a code server-side without adding the
 * matching `actions.*` translation is a compile error here, not a worker reading English they
 * may not understand. `ActionCatalogueTest` enforces the same thing from the other side.
 */
export type ActionCode =
  | "STOP_WORK"
  | "RESUME_WORK"
  | "REST_10_MIN_HOURLY"
  | "REST_15_MIN_HOURLY"
  | "REST_10_MIN"
  | "REST_15_MIN"
  | "HYDRATE_HOURLY"
  | "HYDRATE_REGULARLY"
  | "HYDRATE"
  | "SHADE_RECOVERY"
  | "SEEK_SHADE"
  | "RESCHEDULE_HEAVY_WORK"
  | "ROTATE_TO_LIGHT_DUTY"
  | "CLOSE_MONITORING";

/** The topic a mitigation is grouped under. Mirrors `ActionCatalogue`'s category values. */
export type MitigationCategory =
  | "STOP_WORK"
  | "REST"
  | "HYDRATION"
  | "SHADE_COOLING"
  | "WORK_SCHEDULING"
  | "MONITORING";

/**
 * Mirrors `mitigation/domain/MitigationSuggestion.java`.
 *
 * `actionCode` and `category` are nullable because plans drafted before SCRUM-119 do not carry
 * them. Render from `actionCode` whenever it is present — `action` is server-authored English
 * that this app cannot translate, and parsing it for numbers works in English and fails in the
 * other six locales.
 */
export interface Mitigation {
  priority: string | null;
  action: string;
  rationale: string | null;
  estimatedImpact: string | null;
  actionCode: ActionCode | null;
  category: MitigationCategory | null;
}

/** Mirrors `Approval.ApprovalDecision`. */
export type ApprovalDecision = "APPROVED" | "REJECTED" | "EDITED";

/** Mirrors `RecommendationController.ApprovalResponse` (SCRUM-119). */
export interface Approval {
  id: string;
  approverId: string;
  decision: ApprovalDecision;
  reason: string | null;
  /** Present only for an EDITED decision — what the supervisor actually approved. */
  editedMitigations: Mitigation[] | null;
  decidedAt: string;
}

/** Mirrors `Recommendation.RecommendationStatus`. Server-controlled. */
export type RecommendationStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED";

/**
 * Mirrors `RecommendationController.RecommendationResponse` (SCRUM-119).
 *
 * `mitigations` is always the agent's original draft — it is never overwritten by a decision,
 * so "what did the supervisor change" stays renderable as a diff against
 * `approval.editedMitigations`.
 */
export interface Recommendation {
  id: string;
  shiftId: string;
  /** Which policy version produced this. Shown so the supervisor can judge it (US-08/FR-16). */
  policyVersion: string | null;
  status: RecommendationStatus;
  rationale: string | null;
  createdAt: string;
  mitigations: Mitigation[];
  /** Null while the recommendation is still awaiting a decision. */
  approval: Approval | null;
}

/**
 * What a worker reports about how they are coping (US-11).
 *
 * Mirrors `wellbeing/domain/WellbeingLog.java`. A log is a timestamp and a kind — deliberately
 * nothing else, because the control that records it has to be usable in gloves, in the sun,
 * mid-shift.
 */
export type WellbeingLogType = "REST" | "HYDRATION";

/** SELF when the worker tapped the button; INSTRUCTED when a dispatched rest ran to completion. */
export type WellbeingLogSource = "SELF" | "INSTRUCTED";

export interface WellbeingLog {
  id: string;
  shiftId: string;
  logType: WellbeingLogType;
  source: WellbeingLogSource;
  loggedAt: string;
}

/** Mirrors `shift/domain/SymptomFlag.java`. Every value has an `symptoms.*` translation. */
export type SymptomFlag =
  | "NONE"
  | "DIZZINESS"
  | "NAUSEA"
  | "HEADACHE"
  | "FATIGUE"
  | "MUSCLE_CRAMPS"
  | "OTHER";

/**
 * Mirrors `Concern.ConcernStatus`. There is no RESOLVED — the app can know a supervisor saw the
 * report, not whether the worker is now all right.
 */
export type ConcernStatus = "OPEN" | "ACKNOWLEDGED";

/** Mirrors `WorkerWellbeingController.ConcernResponse`. */
export interface Concern {
  id: string;
  shiftId: string;
  workerId: string;
  symptoms: SymptomFlag[];
  /** The worker's own words, in their own language. Null when they chose only chips. */
  note: string | null;
  status: ConcernStatus;
  raisedAt: string;
  acknowledgedAt: string | null;
}

/**
 * Mirrors `SupervisorWellbeingController.CrewWellbeingRow` — one row per worker who has logged
 * anything. A worker with no logs is absent, and the screen renders "nothing logged" from the
 * shift's own roster rather than expecting an empty row here.
 */
export interface CrewWellbeingRow {
  workerId: string;
  lastRestAt: string | null;
  lastRestSource: WellbeingLogSource | null;
  lastHydrationAt: string | null;
  restCount: number;
  hydrationCount: number;
}

/**
 * Heat policy versioning (SCRUM-120 / US-24).
 *
 * Mirrors `policy/api/PolicyVersionController.PolicyVersionResponse`. A version is the set of
 * WBGT thresholds in force at a site, with the source it came from and the date it takes effect —
 * so a recommendation can be traced to the exact rules that produced it rather than to a label
 * somebody typed.
 */
export type PolicyVersionStatus = "DRAFT" | "ACTIVE" | "SUPERSEDED";

/**
 * The three acclimatisation levels a threshold set is indexed by, and the three intensities
 * within each. Named here so the screens can iterate them rather than hardcoding nine field
 * names in render order.
 */
export type AcclimatisationLevel = "UNACCLIMATISED" | "PARTIAL" | "FULL";

export interface PolicyVersion {
  id: string;
  siteId: string;
  /** Unique per site — the server answers 409 on a duplicate. */
  versionLabel: string;
  /** Where the rules came from, e.g. "MOM Work-Rest Guidelines 2026 rev 1". */
  source: string;
  /** ISO 8601 *date*, no time. The server stores a LocalDate. */
  effectiveDate: string;
  status: PolicyVersionStatus;

  /*
   * Numbers, not strings. The server's `BigDecimal` serialises as a JSON number (25.0), and
   * typing these as strings made `TextInput value={25}` render blank — the create form opened
   * with every threshold empty while claiming to have copied them. Whatever the merits of
   * carrying decimals as strings, this is what the wire actually sends.
   */
  wbgtThresholdUnacclimatisedLight: number;
  wbgtThresholdUnacclimatisedModerate: number;
  wbgtThresholdUnacclimatisedHeavy: number;
  wbgtThresholdPartialLight: number;
  wbgtThresholdPartialModerate: number;
  wbgtThresholdPartialHeavy: number;
  wbgtThresholdFullLight: number;
  wbgtThresholdFullModerate: number;
  wbgtThresholdFullHeavy: number;
  /** Stop work at or above this, whatever the acclimatisation. Server bounds it to 20..40. */
  wbgtEmergencyStop: number;

  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Null until activated. */
  activatedAt: string | null;
  /** Null unless a later version replaced this one. */
  supersededAt: string | null;
}
