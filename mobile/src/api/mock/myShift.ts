/**
 * Stand-in for the caller's current-or-next shift.
 *
 * ── CONTRACT EXISTS, ENDPOINT DOES NOT ──────────────────────────────────────────────────
 * `GET /api/v1/shifts/me` is fully specified in `docs/api/shift-readiness.yaml` (SCRUM-162)
 * — request, response, 401/403 semantics and all. No controller implements it. The only
 * shift endpoints that exist are the site-scoped supervisor CRUD in `ShiftController`, and
 * those are the wrong shape for a worker: they return every assignment on a shift, and this
 * one must return only the caller's own.
 *
 * This mock returns the non-null `shift` branch of `MyShiftResponse` exactly as specified,
 * minus `latestReadiness` — readiness submission is SCRUM-162's other half and out of scope
 * here. When the endpoint lands, `endpoints/shifts.ts` switches over and this file goes.
 * ────────────────────────────────────────────────────────────────────────────────────────
 *
 * @author Justin Chua
 */
import type { MyShift } from "@/types/domain";
import { DEMO_SITES } from "@/auth/demoUsers";

export function mockMyShift(): MyShift {
  const now = Date.now();

  return {
    shiftId: "33333333-3333-4333-8333-333333333333",
    siteId: DEMO_SITES.bishan.id,
    // A shift already under way: the worker screen's normal case, and the only one where
    // live conditions and a stop-work banner mean anything.
    startsAt: new Date(now - 2 * 60 * 60_000).toISOString(),
    endsAt: new Date(now + 5 * 60 * 60_000).toISOString(),
    status: "ACTIVE",
    assignment: {
      taskName: "Kerb laying, east verge",
      // HEAVY so the policy engine produces a mandatory rest — without it the guidance
      // list renders only advisories and the override behaviour is far less visible.
      intensity: "HEAVY",
      // Mid ramp-up. FR-07 tracks the seven-day acclimatisation period, and day 3 of 7 is
      // the case worth seeing on screen.
      acclimatisationDay: 3,
    },
  };
}
