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
} as const;
