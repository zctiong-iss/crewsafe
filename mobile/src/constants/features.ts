/**
 * Feature flags for surfaces that are built and working but deliberately not shown.
 *
 * ── WHY A FLAG RATHER THAN DELETING OR COMMENTING OUT ───────────────────────────────────
 * Commented-out JSX is the usual way this gets done and it is the worst of the three. It is
 * invisible to `tsc`, so it rots the moment a prop or a translation key changes underneath
 * it, and the rot is only discovered by whoever eventually uncomments it — at which point
 * the code no longer compiles and nobody remembers what it was meant to do.
 *
 * Deleting is honest but loses the reasoning: `HeatGuidance` is not scaffolding, it is the
 * only surface that renders FR-15's policy actions with the FR-16 rule references beside
 * them, and rebuilding that from the ticket alone would take longer than it took the first
 * time.
 *
 * A flag keeps the component compiled, typechecked and one boolean away from returning,
 * with the reason it was switched off written next to the switch.
 *
 * @author Justin Chua
 */

export const features = {
  /**
   * The "What you must do" heat-plan card on the worker's shift screen.
   *
   * OFF as of SCRUM-199's follow-up, at the product owner's request.
   *
   * ── WHAT IS LOST WHILE THIS IS OFF ──────────────────────────────────────────────────
   * This is the app's only surface for the deterministic policy engine's output. With it
   * hidden, a worker no longer sees:
   *
   *   • mandatory heat actions (hydrate hourly, rest 10/15 min per hour) — FR-15
   *   • the rule reference behind each one (HS-31-HYDRATE, HS-32-HEAVY) — FR-16
   *   • the policy version that produced them — FR-16
   *   • the worded "heat plan suspended" notice during a lightning stop-work — FR-12a
   *
   * The last of those is the only one with a surviving equivalent: `WbgtCard` renders its
   * own "superseded by the lightning stop-work" label, so the override is still stated in
   * words rather than carried by dimming alone.
   *
   * The others have no equivalent anywhere in the app. The dispatch inbox shows actions a
   * *supervisor* approved and sent; it does not show what the policy engine requires on its
   * own. So while this is off, a worker on a HEAVY task at 32.4°C WBGT is not told in the
   * app that an hourly ten-minute rest is mandatory.
   *
   * Flip to `true` to restore. Nothing else needs to change.
   */
  heatGuidanceCard: false,

  /**
   * The supervisor's "Draft a plan" control on a shift (SCRUM-118 / US-08).
   *
   * ON since SCRUM-289 built `POST /api/v1/sites/{siteId}/shifts/{shiftId}/recommendations/generate`
   * — the endpoint this control was written against, with the request and response shapes the
   * SCRUM-118 design fixed. Nothing else needed changing, exactly as this comment predicted while
   * the flag was off.
   *
   * Two things a supervisor should expect from a tap, both by design rather than by accident:
   *
   *   • It is slow — roughly 10–20 s, because it makes a live model call. Hence `generating`
   *     driving the button's loading state; there is no faster path that still asks a model.
   *   • It always succeeds in producing a plan. Lightning, an unreachable ml-service, or a draft
   *     the server's validation gate rejects all fall back to a plan built deterministically from
   *     the policy decision, returned as a normal 201. A failure toast here means the *request*
   *     was refused (shift closed, no WBGT reading for the site), never that the model misbehaved.
   */
  draftPlanTrigger: true,

  /**
   * The safety manager's Plans tab.
   *
   * OFF at the product owner's request. Hidden, deliberately NOT deleted — the screen, its
   * stack, its tests and its translations all stay compiled and typechecked behind this
   * boolean, so turning it back on is one edit rather than a rebuild.
   *
   * ── WHAT IS LOST WHILE THIS IS OFF ──────────────────────────────────────────────────
   * A safety manager can no longer browse the raw plan list, or open a plan from it. They
   * keep the Oversight tab, which since SCRUM-TBD-110 shows one plan per shift per site —
   * the plan actually in force — and which is the surface built for the oversight question.
   * The Plans tab was the older, flatter view of the same data.
   *
   * A manager could not decide a plan from here anyway: approve and reject are the
   * supervisor's, and `RecommendationDetailScreen` already renders read-only for anyone
   * without decision rights. So nothing that was theirs to do has been taken away.
   *
   * ── SUPERVISORS ARE UNAFFECTED ──────────────────────────────────────────────────────
   * This flag gates the SAFETY MANAGER's tab only. The supervisor's Plans tab is where plans
   * are approved and rejected, and hiding it would remove the app's only decision surface.
   * `SupervisorTabs` does not read this flag, on purpose.
   */
  safetyManagerPlansTab: false,
} as const;
