/** @author Jemilin Beulah, Tang Chee Seng */

import { http, HttpResponse } from "msw";
import type { EffectivePolicyVersion, PolicyVersion } from "@/api/policy";
import type { LightningObservation, LightningRisk } from "@/api/lightning";

const BASE = "http://localhost:8080";   // matching VITE_API_BASE_URL stubbed in setup.ts

/** Error body text. Mirrors ErrorResponse.java. */
const errorBody = (error: string, message: string) => ({
  error,
  message,
  requestId: "test-request-id",
});

// Policy versions for site-1: one of each status, so tests can exercise the full catalogue
// without needing a freshly-seeded site's trivial single-ACTIVE-version case.
const POLICY_THRESHOLDS = {
  wbgtThresholdUnacclimatisedLight: 25, wbgtThresholdUnacclimatisedModerate: 24, wbgtThresholdUnacclimatisedHeavy: 23,
  wbgtThresholdPartialLight: 26, wbgtThresholdPartialModerate: 25, wbgtThresholdPartialHeavy: 24,
  wbgtThresholdFullLight: 28, wbgtThresholdFullModerate: 27, wbgtThresholdFullHeavy: 26,
};

const SUPERSEDED_POLICY_VERSION: PolicyVersion = {
  id: "policy-superseded", siteId: "site-1", versionLabel: "MOM-WBGT-2026.1",
  source: "MOM Heat Stress Advisory 2026", effectiveDate: "2026-01-01", status: "SUPERSEDED",
  ...POLICY_THRESHOLDS, wbgtEmergencyStop: 33, notes: null, createdBy: "u-1",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z",
  activatedAt: "2026-01-01T00:00:00Z", supersededAt: "2026-07-01T00:00:00Z",
};

const ACTIVE_POLICY_VERSION: PolicyVersion = {
  id: "policy-active", siteId: "site-1", versionLabel: "MOM-WBGT-2026.2",
  source: "MOM Heat Stress Advisory, revised July 2026", effectiveDate: "2026-07-01", status: "ACTIVE",
  ...POLICY_THRESHOLDS, wbgtEmergencyStop: 33, notes: "Revised after mid-year review.", createdBy: "u-1",
  createdAt: "2026-06-20T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z",
  activatedAt: "2026-07-01T00:00:00Z", supersededAt: null,
};

const DRAFT_POLICY_VERSION: PolicyVersion = {
  id: "policy-draft", siteId: "site-1", versionLabel: "MOM-WBGT-2026.3",
  source: "MOM Heat Stress Advisory, draft revision", effectiveDate: "2026-09-01", status: "DRAFT",
  ...POLICY_THRESHOLDS, wbgtEmergencyStop: 33, notes: null, createdBy: "u-1",
  createdAt: "2026-08-10T00:00:00Z", updatedAt: "2026-08-10T00:00:00Z",
  activatedAt: null, supersededAt: null,
};

// site-2's own catalogue, distinct from site-1's, so a test can tell which one is on screen.
const SITE_2_ACTIVE_POLICY_VERSION: PolicyVersion = {
  id: "policy-site-2-active", siteId: "site-2", versionLabel: "NUS-WBGT-2026.1",
  source: "NUS Campus Risk Assessment 2026", effectiveDate: "2026-02-01", status: "ACTIVE",
  ...POLICY_THRESHOLDS, wbgtEmergencyStop: 32, notes: null, createdBy: "u-1",
  createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z",
  activatedAt: "2026-02-01T00:00:00Z", supersededAt: null,
};

const POLICY_VERSIONS_BY_SITE: Record<string, PolicyVersion[]> = {
  "site-1": [ACTIVE_POLICY_VERSION, DRAFT_POLICY_VERSION, SUPERSEDED_POLICY_VERSION],
  "site-2": [SITE_2_ACTIVE_POLICY_VERSION],
};

// The company-wide default (siteId null) PolicyEngineService falls back to for a site with
// no catalogue of its own — mirrors V16's seeded row.
const DEFAULT_POLICY_VERSION: EffectivePolicyVersion = {
  id: "policy-company-default", siteId: null, versionLabel: "MOM-WBGT-2026-DEFAULT",
  source: "MOM Work-Rest Guidelines 2026 (company-wide default)", effectiveDate: "2026-01-01", status: "ACTIVE",
  ...POLICY_THRESHOLDS, wbgtEmergencyStop: 33, notes: "Company-wide fallback for a site with no policy of its own.",
  createdBy: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  activatedAt: "2026-01-01T00:00:00Z", supersededAt: null,
};

// site-1 is CLEAR with two ticks (one with a distant strike, one with none), so tests can
// exercise both the "km away" and "no strikes" renderings without needing a stop-work fixture.
const SITE_1_LIGHTNING_RISK: LightningRisk = {
  siteId: "site-1", state: "CLEAR", nearestStrikeKm: null,
  observedAt: "2026-08-14T05:20:00Z", validUntil: "2026-08-14T05:50:00Z", freshness: "LIVE",
};

const SITE_1_LIGHTNING_OBSERVATIONS: LightningObservation[] = [
  {
    id: "obs-2", siteId: "site-1", nearestStrikeKm: null, nearestStrikeAt: null,
    observedAt: "2026-08-14T05:20:00Z", ingestedAt: "2026-08-14T05:21:31Z",
    source: "NEA", qualityStatus: "LIVE",
  },
  {
    id: "obs-1", siteId: "site-1", nearestStrikeKm: 32.5, nearestStrikeAt: "2026-08-14T05:17:40Z",
    observedAt: "2026-08-14T05:18:00Z", ingestedAt: "2026-08-14T05:19:31Z",
    source: "NEA", qualityStatus: "LIVE",
  },
];

const LIGHTNING_RISK_BY_SITE: Record<string, LightningRisk> = {
  "site-1": SITE_1_LIGHTNING_RISK,
};

const LIGHTNING_OBSERVATIONS_BY_SITE: Record<string, LightningObservation[]> = {
  "site-1": SITE_1_LIGHTNING_OBSERVATIONS,
  "site-2": [],
};

export const handlers = [

  // Shifts list for the site. One PLANNED shift whose sole assignment resolves to "Worker One".
  http.get(`${BASE}/api/v1/sites/:siteId/shifts`, ({ params }) =>
    HttpResponse.json([
      {
        id: "shift-1",
        siteId: params.siteId,
        startsAt: "2030-08-10T00:00:00Z",   // 08:00 SGT 10 Aug → renders "10 Aug"
        endsAt: "2030-08-10T08:00:00Z",
        status: "PLANNED",
        assignments: [
          {
            id: "a-1",
            workerId: "00000000-0000-4000-8000-000000000001", // = "Worker One"
            intensity: "MODERATE",
            taskName: "Grass Cutting",
            acclimatisationDay: 2,
          },
        ],
      },
    ]),
  ),

  http.post(`${BASE}/api/v1/sites/:siteId/shifts`, async ({ params, request }) => {
    const { siteId } = params;
    const body = await request.json() as {
        startsAt: string; endsAt: string
    }

    if (siteId === "unauthorised-worksite")
        return HttpResponse.json(errorBody(
            "Forbidden",
            "Access denied. You are not accessing your assigned worksite."),
            {
            status: 403
            }
        );

    if (new Date(body.endsAt) <= new Date(body.startsAt)){
    return HttpResponse.json(errorBody(
        "Bad Request",
        "Invalid values for assignment start and end time. The end time cannot be before the start time."),
        {
            status: 400
        }
        );
    }

    return HttpResponse.json(
        { id: "shift-1",
            siteId,
            status: "PLANNED", ...body }, { status: 201 });
    }),

  // The picker's source.
  http.get(`${BASE}/api/v1/sites/:siteId/workers`, () =>
    HttpResponse.json([
      { id: "00000000-0000-4000-8000-000000000001", displayName: "Worker One" },
      { id: "00000000-0000-4000-8000-000000000002", displayName: "Worker Two" },
    ]),
  ),

  http.get(`${BASE}/api/v1/me`, () =>
  HttpResponse.json({
    id: "u-1",
    username: "supervisor",
    displayName: "Supervisor",
    role: "SUPERVISOR",
    siteIds: ["site-1"],
  }),
),

http.get(`${BASE}/api/v1/sites`, () =>
  HttpResponse.json([
    { id: "site-1", name: "Bishan Park Landscaping", latitude: 1.3622, longitude: 103.8455, timezone: "Asia/Singapore" },
    { id: "site-2", name: "NUS Campus Maintenance",  latitude: 1.2966, longitude: 103.7764, timezone: "Asia/Singapore" },
  ]),
),

http.get(`${BASE}/api/v1/sites/:siteId/policy-versions`, ({ params }) =>
  HttpResponse.json(POLICY_VERSIONS_BY_SITE[params.siteId as string] ?? []),
),

http.get(`${BASE}/api/v1/sites/:siteId/policy-versions/active`, ({ params }) => {
  const found = (POLICY_VERSIONS_BY_SITE[params.siteId as string] ?? [])
    .find((v) => v.status === "ACTIVE");
  return found
    ? HttpResponse.json(found)
    : HttpResponse.json(errorBody("Not Found", "No active policy version for this site."), { status: 404 });
}),

http.get(`${BASE}/api/v1/sites/:siteId/policy-versions/effective`, ({ params }) => {
  const own = (POLICY_VERSIONS_BY_SITE[params.siteId as string] ?? [])
    .find((v) => v.status === "ACTIVE");
  return HttpResponse.json(own ?? DEFAULT_POLICY_VERSION);
}),

http.post(`${BASE}/api/v1/sites/:siteId/policy-versions`, async ({ params, request }) => {
  const body = await request.json() as Record<string, unknown>;
  return HttpResponse.json(
    {
      id: "policy-created", siteId: params.siteId, status: "DRAFT",
      createdBy: "u-1", createdAt: "2026-08-13T00:00:00Z", updatedAt: "2026-08-13T00:00:00Z",
      activatedAt: null, supersededAt: null, notes: null,
      ...body,
    },
    { status: 201 },
  );
}),

http.post(`${BASE}/api/v1/sites/:siteId/policy-versions/:versionId/activate`, ({ params }) => {
  const version = (POLICY_VERSIONS_BY_SITE[params.siteId as string] ?? [])
    .find((v) => v.id === params.versionId);
  if (!version) {
    return HttpResponse.json(errorBody("Not Found", "No such policy version."), { status: 404 });
  }
  return HttpResponse.json({ ...version, status: "ACTIVE", activatedAt: "2026-08-13T00:00:00Z" });
}),

// Site forecast (SCRUM-434 fallback panel): a healthy live-model reading by default.
http.get(`${BASE}/api/v1/sites/:siteId/weather/forecast`, () =>
  HttpResponse.json({
    predictedValue: 31.4,
    horizonMinutes: 30,
    modelVersion: "wbgt-1.2.0",
    confidenceIntervalLower: 30.9,
    confidenceIntervalUpper: 31.9,
    generatedAt: "2026-08-16T08:00:00Z",
    basis: "MODEL",
    inputAgeMinutes: 8,
    degraded: false,
  }),
),

// Deployed-model status (SCRUM-434 accuracy panel): approved, one 30-min horizon.
http.get(`${BASE}/api/v1/ml/model-status`, () =>
  HttpResponse.json({
    modelVersion: "wbgt-1.2.0",
    approvedForInference: true,
    approvalBlocker: null,
    horizons: {
      "30": {
        mae: 0.42, rmse: 0.61, meanBias: -0.05, macroF1: 0.78,
        recallAtLeast32: 0.91, recallAtLeast33: 0.88,
        maeByActualBand: { "<31": 0.3, "31–32": 0.45, "≥33": 0.7 },
        confusionMatrix: [[10, 1], [2, 8]],
        sampleCount: 500,
      },
    },
  }),
),

http.get(`${BASE}/api/v1/sites/:siteId/lightning`, ({ params }) => {
  const risk = LIGHTNING_RISK_BY_SITE[params.siteId as string];
  return risk
    ? HttpResponse.json(risk)
    : HttpResponse.json(errorBody("Not Found", "No lightning data ingested for this site."), { status: 404 });
}),

http.get(`${BASE}/api/v1/sites/:siteId/lightning/observations`, ({ params }) =>
  HttpResponse.json(LIGHTNING_OBSERVATIONS_BY_SITE[params.siteId as string] ?? []),
),
];
