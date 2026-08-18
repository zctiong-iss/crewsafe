/**
 * The seen-plan set, whose two failure modes both produce notification bursts.
 *
 * @author Justin Chua
 */
import reducer, {
  hasSeededPlans,
  planIdsAnnounced,
  seenPlansSeeded,
  seenPlansCleared,
  SEEN_PLAN_LIMIT,
} from "./notificationsSlice";

const empty = () => reducer(undefined, { type: "@@INIT" });

it("starts with no entry for anyone, which is what makes first-load seeding work", () => {
  const state = empty();

  expect(hasSeededPlans(state, "sup-1")).toBe(false);
});

it("records a seed without announcing anything", () => {
  const next = reducer(empty(), seenPlansSeeded({ userId: "sup-1", planIds: ["a", "b"] }));

  expect(next.seenPlanIdsByUser["sup-1"]).toEqual(["a", "b"]);
  expect(hasSeededPlans(next, "sup-1")).toBe(true);
});

it("seeds an empty list as a real answer, not as never-asked", () => {
  /*
   * A site with no plans yet still counts as seeded. Treating an empty array as "never loaded"
   * would re-seed on every poll, and the first plan ever drafted would be swallowed as part of
   * a baseline rather than announced.
   */
  const next = reducer(empty(), seenPlansSeeded({ userId: "sup-1", planIds: [] }));

  expect(hasSeededPlans(next, "sup-1")).toBe(true);
});

it("refuses to seed twice", () => {
  /*
   * A second seed would discard everything announced since the first, and every one of those
   * plans would notify again on the next poll.
   */
  const seeded = reducer(empty(), seenPlansSeeded({ userId: "sup-1", planIds: ["a"] }));
  const announced = reducer(seeded, planIdsAnnounced({ userId: "sup-1", planIds: ["b"] }));

  const next = reducer(announced, seenPlansSeeded({ userId: "sup-1", planIds: ["a"] }));

  expect(next.seenPlanIdsByUser["sup-1"]).toEqual(["b", "a"]);
});

it("keeps one user's set away from another's", () => {
  // Site phones are shared. Inheriting a colleague's set would silently swallow every plan
  // drafted during their shift.
  const first = reducer(empty(), seenPlansSeeded({ userId: "sup-1", planIds: ["a"] }));
  const second = reducer(first, seenPlansSeeded({ userId: "sup-2", planIds: ["b"] }));

  expect(second.seenPlanIdsByUser["sup-1"]).toEqual(["a"]);
  expect(second.seenPlanIdsByUser["sup-2"]).toEqual(["b"]);
});

it("does not duplicate an id that is announced twice", () => {
  const seeded = reducer(empty(), seenPlansSeeded({ userId: "sup-1", planIds: ["a"] }));

  const next = reducer(seeded, planIdsAnnounced({ userId: "sup-1", planIds: ["a"] }));

  expect(next.seenPlanIdsByUser["sup-1"]).toEqual(["a"]);
});

it("caps the set, dropping the oldest first", () => {
  /*
   * Persisted and never otherwise pruned, so it needs a bound. Newest-first because a dropped
   * id can at worst cause one duplicate notification, and the ones worth protecting from that
   * are the recent ones.
   */
  const many = Array.from({ length: SEEN_PLAN_LIMIT + 5 }, (_, i) => `plan-${i}`);
  const seeded = reducer(empty(), seenPlansSeeded({ userId: "sup-1", planIds: many }));

  const next = reducer(seeded, planIdsAnnounced({ userId: "sup-1", planIds: ["newest"] }));

  const stored = next.seenPlanIdsByUser["sup-1"];
  expect(stored).toHaveLength(SEEN_PLAN_LIMIT);
  expect(stored[0]).toBe("newest");
});

it("clears every user's set on a dev reset", () => {
  const seeded = reducer(empty(), seenPlansSeeded({ userId: "sup-1", planIds: ["a"] }));

  const next = reducer(seeded, seenPlansCleared());

  expect(next.seenPlanIdsByUser).toEqual({});
});
