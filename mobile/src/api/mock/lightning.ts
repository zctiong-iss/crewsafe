/**
 * Stand-in for the site lightning risk state.
 *
 * ── MISSING BACKEND ─────────────────────────────────────────────────────────────────────
 * Nothing behind this exists yet. There is no lightning ingestion, no risk classifier and
 * no endpoint anywhere in `backend/src/main/java/com/crewsafe/` — FR-10a and SCRUM-170 are
 * both unstarted. `weather/` ingests WBGT and supporting readings only.
 *
 * What SCRUM-172 needs from SCRUM-170, and the shape this mock commits to:
 *
 *   GET /api/v1/sites/{siteId}/lightning        (site-scoped, same @PreAuthorize as
 *                                                SiteController — any assigned role reads)
 *   200 {
 *     "siteId":          uuid,
 *     "state":           "CLEAR" | "ADVISORY" | "STOP_WORK",
 *     "nearestStrikeKm": number | null,
 *     "observedAt":      iso-8601,
 *     "validUntil":      iso-8601
 *   }
 *
 * `validUntil` is the field the whole story turns on. §7.1 holds a stop-work until a
 * supervisor-confirmed all-clear, typically 30 minutes after the last nearby strike, so the
 * server must publish when its own assessment lapses rather than leaving the client to
 * infer it from `observedAt` plus a hardcoded constant. A client-side constant would drift
 * from the policy the moment the policy changed — and this is a stop-work decision.
 *
 * Distance comes from the NEA lightning observation feed
 * (data.gov.sg dataset d_08238953fe0f6dd13f10714ebfbcb9f9) against the site's lat/long,
 * which `Site.java` already stores for exactly this purpose.
 * ────────────────────────────────────────────────────────────────────────────────────────
 *
 * @author Justin Chua
 */
import type { LightningRisk } from "@/types/domain";
import {
  getLightningScenario,
  MOCK_ADVISORY_WINDOW_MS,
  MOCK_STOP_WORK_WINDOW_MS,
} from "./scenario";

export function mockLightningRisk(siteId: string): LightningRisk {
  const now = Date.now();
  const scenario = getLightningScenario();

  if (scenario === "clear") {
    return {
      siteId,
      state: "CLEAR",
      nearestStrikeKm: null,
      observedAt: new Date(now).toISOString(),
      // A clear state still carries a window: it means "assessed clear as of now, re-check
      // after this". Without one the UI cannot tell "clear" from "stale and unknown".
      validUntil: new Date(now + MOCK_ADVISORY_WINDOW_MS).toISOString(),
    };
  }

  if (scenario === "advisory") {
    return {
      siteId,
      state: "ADVISORY",
      nearestStrikeKm: 11.8,
      observedAt: new Date(now - 60_000).toISOString(),
      validUntil: new Date(now + MOCK_ADVISORY_WINDOW_MS).toISOString(),
    };
  }

  return {
    siteId,
    state: "STOP_WORK",
    // Inside the range that would trigger a stop-work on a real feed.
    nearestStrikeKm: 4.2,
    observedAt: new Date(now - 30_000).toISOString(),
    validUntil: new Date(now + MOCK_STOP_WORK_WINDOW_MS).toISOString(),
  };
}
