/**
 * Which plans a manager sees at rest, and which are collapsed (SCRUM-TBD-110).
 *
 * ── THE CASE THAT MATTERS MOST ──────────────────────────────────────────────────────────
 * Grouping by shift is not cosmetic. A site's plans arrive from every shift on it, so
 * "the site's latest plan" would hide a decision awaiting a supervisor on one crew because an
 * unrelated crew got a newer draft. Several cases below use two shifts for exactly that
 * reason — a single-shift fixture passes whether or not the grouping works.
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

it("shows only the newest plan per shift at rest", () => {
  const groups = groupPlansByShift(NEWEST_FIRST, SHIFTS);

  expect(groups[0].current.map((p) => p.id)).toEqual(["p5"]);
  expect(groups[1].current.map((p) => p.id)).toEqual(["p4"]);
});

it("does not let one crew's newer plan hide another crew's", () => {
  /*
   * The reason grouping is per shift. p5 (shift-a, 15:26) is the site's newest plan overall;
   * a site-level "latest" would show it alone and hide p4, which is shift-b's current plan
   * and may be awaiting a decision.
   */
  const groups = groupPlansByShift(NEWEST_FIRST, SHIFTS);
  const shown = groups.flatMap((g) => g.current.map((p) => p.id));

  expect(shown).toContain("p5");
  expect(shown).toContain("p4");
});

it("collapses the rest, newest first, losing nothing", () => {
  const groups = groupPlansByShift(NEWEST_FIRST, SHIFTS);

  expect(groups[0].earlier.map((p) => p.id)).toEqual(["p3", "p2"]);
  expect(groups[1].earlier.map((p) => p.id)).toEqual(["p1"]);

  // Every plan is reachable: nothing is dropped, only moved behind a control.
  const all = groups.flatMap((g) => [...g.current, ...g.earlier].map((p) => p.id));
  expect(all.sort()).toEqual(["p1", "p2", "p3", "p4", "p5"]);
});

it("shows the newest plan even when it is SUPERSEDED", () => {
  /*
   * Status never decides what is current. A superseded plan is only newest when the draft
   * that replaced it failed — which is the one case worth seeing, so filtering by status
   * would hide exactly the signal that something went wrong.
   */
  const items = [
    plan("s2", "shift-a", "2026-08-18T15:09:00Z", "SUPERSEDED"),
    plan("s1", "shift-a", "2026-08-18T14:39:00Z", "APPROVED"),
  ];

  const [group] = groupPlansByShift(items, SHIFTS);
  expect(group.current.map((p) => p.id)).toEqual(["s2"]);
  expect(group.current[0].status).toBe("SUPERSEDED");
});

/* ── Stop-work is never collapsed ───────────────────────────────────────────────────────── */

it("keeps an in-force stop-work visible under a newer plan", () => {
  /*
   * An AUTO_DISPATCHED plan was sent to a crew without approval (SCRUM-440). It is a live
   * instruction, and hiding it because something newer exists would take the most severe
   * thing the system can show off the screen built to oversee it.
   */
  const items = [
    plan("newer", "shift-a", "2026-08-18T15:30:00Z"),
    plan("stopwork", "shift-a", "2026-08-18T15:17:00Z", "AUTO_DISPATCHED"),
    plan("old", "shift-a", "2026-08-18T14:39:00Z", "SUPERSEDED"),
  ];

  const [group] = groupPlansByShift(items, SHIFTS);

  expect(group.current.map((p) => p.id)).toEqual(["newer", "stopwork"]);
  expect(group.earlier.map((p) => p.id)).toEqual(["old"]);
});

it("does not duplicate a stop-work that is itself the newest plan", () => {
  const items = [
    plan("stopwork", "shift-a", "2026-08-18T15:26:00Z", "AUTO_DISPATCHED"),
    plan("old", "shift-a", "2026-08-18T14:39:00Z", "SUPERSEDED"),
  ];

  const [group] = groupPlansByShift(items, SHIFTS);
  expect(group.current.map((p) => p.id)).toEqual(["stopwork"]);
});

it("keeps every stop-work when a shift has more than one", () => {
  // Two stop-works can coexist: the server only ever supersedes PENDING_APPROVAL, so neither
  // replaces the other. Both are live instructions.
  const items = [
    plan("sw2", "shift-a", "2026-08-18T15:26:00Z", "AUTO_DISPATCHED"),
    plan("sw1", "shift-a", "2026-08-18T15:17:00Z", "AUTO_DISPATCHED"),
    plan("old", "shift-a", "2026-08-18T14:39:00Z", "SUPERSEDED"),
  ];

  const [group] = groupPlansByShift(items, SHIFTS);
  expect(group.current.map((p) => p.id)).toEqual(["sw2", "sw1"]);
  expect(group.earlier.map((p) => p.id)).toEqual(["old"]);
});

/* ── Edges ─────────────────────────────────────────────────────────────────────────────── */

it("attaches each group's shift window", () => {
  const groups = groupPlansByShift(NEWEST_FIRST, SHIFTS);
  expect(groups[0].shift?.id).toBe("shift-a");
  expect(groups[1].shift?.startsAt).toBe("2026-08-18T14:00:00Z");
});

it("still groups a plan whose shift was not returned", () => {
  // A shift can move site or be deleted after its plans were drafted. The group renders with
  // no window rather than the plan vanishing.
  const items = [plan("orphan", "shift-gone", "2026-08-18T15:00:00Z")];

  const [group] = groupPlansByShift(items, SHIFTS);
  expect(group.shift).toBeNull();
  expect(group.current.map((p) => p.id)).toEqual(["orphan"]);
});

it("returns nothing for a site with no plans", () => {
  expect(groupPlansByShift([], SHIFTS)).toEqual([]);
});

it("leaves earlier empty when a shift has only one plan", () => {
  const [group] = groupPlansByShift([plan("only", "shift-a", "2026-08-18T15:00:00Z")], SHIFTS);
  expect(group.current.map((p) => p.id)).toEqual(["only"]);
  expect(group.earlier).toEqual([]);
});
