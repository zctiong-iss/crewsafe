/**
 * Which plans a manager sees at rest, and which are collapsed (SCRUM-TBD-110).
 *
 * ── THE CASE THAT MATTERS MOST ──────────────────────────────────────────────────────────
 * A pending draft must never displace a stop-work. The agent redrafts every two minutes, so a
 * shift under an active stop-work is constantly acquiring newer PENDING_APPROVAL plans — and
 * under newest-wins the "Stop-work dispatched" banner would disappear two minutes after a crew
 * was told to shelter. Most of the cases below exist to hold that line from both directions.
 *
 * ── AND WHY TWO SHIFTS KEEP APPEARING ───────────────────────────────────────────────────
 * Grouping by shift is not cosmetic. A site's plans arrive from every shift on it, so
 * "the site's latest plan" would hide a decision awaiting a supervisor on one crew because an
 * unrelated crew got a newer draft. A single-shift fixture passes whether or not the grouping
 * works.
 *
 * @author Justin Chua
 */
import { groupPlansByShift } from "./planGrouping";
import type { PlanShift } from "@/store/reducers/oversightSlice";
import type { Recommendation, RecommendationStatus } from "@/types/domain";

function plan(
  id: string,
  shiftId: string,
  createdAt: string,
  status: RecommendationStatus = "PENDING_APPROVAL",
): Recommendation {
  return {
    id,
    shiftId,
    policyVersion: null,
    status,
    rationale: null,
    createdAt,
    mitigations: [],
    approval: null,
    modelVersion: "anthropic.claude-3-5-sonnet",
  };
}

const SHIFTS: PlanShift[] = [
  { id: "shift-a", startsAt: "2026-08-18T06:00:00Z", endsAt: "2026-08-18T14:00:00Z" },
  { id: "shift-b", startsAt: "2026-08-18T14:00:00Z", endsAt: "2026-08-18T22:00:00Z" },
];

/** Newest first, as `oversightSlice` delivers it. */
const NEWEST_FIRST = [
  plan("p5", "shift-a", "2026-08-18T15:26:00Z"),
  plan("p4", "shift-b", "2026-08-18T15:17:00Z"),
  plan("p3", "shift-a", "2026-08-18T15:09:00Z", "SUPERSEDED"),
  plan("p2", "shift-a", "2026-08-18T14:39:00Z", "SUPERSEDED"),
  plan("p1", "shift-b", "2026-08-18T14:38:00Z", "APPROVED"),
];

it("splits plans into one group per shift", () => {
  const groups = groupPlansByShift(NEWEST_FIRST, SHIFTS);

  expect(groups.map((g) => g.shiftId)).toEqual(["shift-a", "shift-b"]);
});

it("shows exactly one plan per shift", () => {
  // The shape says so too - `plan` is a single Recommendation, not a list - but this is the
  // behaviour that kept regressing, so it is asserted rather than assumed.
  const groups = groupPlansByShift(NEWEST_FIRST, SHIFTS);

  expect(groups.map((g) => g.plan.id)).toEqual(["p5", "p1"]);
});

it("does not let one crew's newer plan hide another crew's", () => {
  const groups = groupPlansByShift(NEWEST_FIRST, SHIFTS);

  expect(groups).toHaveLength(2);
  expect(groups.map((g) => g.shiftId).sort()).toEqual(["shift-a", "shift-b"]);
});

/* -- A pending draft never displaces what is in force ----------------------------------- */

it("keeps the stop-work when the agent redrafts over it", () => {
  /*
   * The reported bug, and the reason this file exists in its current form. The auto-trigger
   * runs every two minutes, so a newer PENDING_APPROVAL plan appears almost immediately after
   * a dispatch - and showing it would take "a crew has been told to shelter" off the screen
   * built to oversee exactly that.
   */
  const items = [
    plan("redraft", "shift-a", "2026-08-18T15:30:00Z"),
    plan("stopwork", "shift-a", "2026-08-18T15:28:00Z", "AUTO_DISPATCHED"),
  ];

  const [group] = groupPlansByShift(items, SHIFTS);
  expect(group.plan.id).toBe("stopwork");
});

it("keeps an approved plan when the agent redrafts over it", () => {
  // A regenerated draft is a proposal. It does not replace what a supervisor signed off.
  const items = [
    plan("redraft", "shift-a", "2026-08-18T15:30:00Z"),
    plan("approved", "shift-a", "2026-08-18T15:28:00Z", "APPROVED"),
  ];

  const [group] = groupPlansByShift(items, SHIFTS);
  expect(group.plan.id).toBe("approved");
});

it("shows a pending draft when nothing precedes it", () => {
  // The other half of the rule: with no instruction in force there is nothing to protect, so
  // the draft awaiting a decision is the most useful thing to show.
  const items = [
    plan("pending", "shift-a", "2026-08-18T15:30:00Z"),
    plan("old", "shift-a", "2026-08-18T15:00:00Z", "SUPERSEDED"),
  ];

  const [group] = groupPlansByShift(items, SHIFTS);
  expect(group.plan.id).toBe("pending");
});

it("shows a pending draft on a shift that has only ever had drafts", () => {
  const items = [plan("only", "shift-a", "2026-08-18T15:30:00Z")];

  const [group] = groupPlansByShift(items, SHIFTS);
  expect(group.plan.id).toBe("only");
});

/* -- Stop-work and approval supersede each other, newest wins --------------------------- */

it("shows only the latest stop-work when a shift has several", () => {
  /*
   * A thirty-minute storm leaves roughly fifteen dispatches on one shift. They are not fifteen
   * instructions - they are one instruction restated.
   */
  const items = [
    plan("sw3", "shift-a", "2026-08-18T15:30:00Z", "AUTO_DISPATCHED"),
    plan("sw2", "shift-a", "2026-08-18T15:26:00Z", "AUTO_DISPATCHED"),
    plan("sw1", "shift-a", "2026-08-18T15:17:00Z", "AUTO_DISPATCHED"),
  ];

  const [group] = groupPlansByShift(items, SHIFTS);
  expect(group.plan.id).toBe("sw3");
});

it("lets an approval supersede an earlier stop-work", () => {
  // Conditions changed, a supervisor approved the new plan, and that is now what stands.
  const items = [
    plan("approved", "shift-a", "2026-08-18T15:40:00Z", "APPROVED"),
    plan("stopwork", "shift-a", "2026-08-18T15:28:00Z", "AUTO_DISPATCHED"),
  ];

  const [group] = groupPlansByShift(items, SHIFTS);
  expect(group.plan.id).toBe("approved");
});

it("lets a stop-work supersede an earlier approval", () => {
  // Lightning arrived after the approval. The newest instruction is the one standing.
  const items = [
    plan("stopwork", "shift-a", "2026-08-18T15:40:00Z", "AUTO_DISPATCHED"),
    plan("approved", "shift-a", "2026-08-18T15:28:00Z", "APPROVED"),
  ];

  const [group] = groupPlansByShift(items, SHIFTS);
  expect(group.plan.id).toBe("stopwork");
});

it("never shows a stop-work and anything else together", () => {
  /*
   * The literal requirement, asserted as such: whatever else a shift holds, the group carries
   * one plan. A list-shaped field is what let a second row come back twice before.
   */
  const items = [
    plan("redraft", "shift-a", "2026-08-18T15:35:00Z"),
    plan("sw2", "shift-a", "2026-08-18T15:30:00Z", "AUTO_DISPATCHED"),
    plan("sw1", "shift-a", "2026-08-18T15:17:00Z", "AUTO_DISPATCHED"),
    plan("approved", "shift-a", "2026-08-18T15:10:00Z", "APPROVED"),
    plan("old", "shift-a", "2026-08-18T14:39:00Z", "SUPERSEDED"),
  ];

  const [group] = groupPlansByShift(items, SHIFTS);
  expect(group.plan.id).toBe("sw2");
});

/* -- History, when nothing is in force --------------------------------------------------- */

it("shows the newest plan even when it is SUPERSEDED", () => {
  // Nothing is instructing anyone, so the newest plan is simply what there is to show.
  const items = [
    plan("newest", "shift-a", "2026-08-18T15:30:00Z", "SUPERSEDED"),
    plan("older", "shift-a", "2026-08-18T15:00:00Z", "SUPERSEDED"),
  ];

  const [group] = groupPlansByShift(items, SHIFTS);
  expect(group.plan.id).toBe("newest");
});

it("does not treat a rejected plan as in force", () => {
  // A rejection is a decision NOT to act. It must not outrank a stop-work.
  const items = [
    plan("rejected", "shift-a", "2026-08-18T15:30:00Z", "REJECTED"),
    plan("stopwork", "shift-a", "2026-08-18T15:20:00Z", "AUTO_DISPATCHED"),
  ];

  const [group] = groupPlansByShift(items, SHIFTS);
  expect(group.plan.id).toBe("stopwork");
});

/* -- Edges ------------------------------------------------------------------------------- */

it("attaches each group's shift window", () => {
  const groups = groupPlansByShift(NEWEST_FIRST, SHIFTS);

  expect(groups[0].shift?.id).toBe("shift-a");
  expect(groups[1].shift?.id).toBe("shift-b");
});

it("still groups a plan whose shift was not returned", () => {
  const items = [plan("orphan", "shift-gone", "2026-08-18T15:30:00Z")];

  const [group] = groupPlansByShift(items, SHIFTS);
  expect(group.shift).toBeNull();
  expect(group.plan.id).toBe("orphan");
});

it("returns nothing for a site with no plans", () => {
  expect(groupPlansByShift([], SHIFTS)).toEqual([]);
});
