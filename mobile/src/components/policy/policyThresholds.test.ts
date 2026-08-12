/**
 * The threshold grid and the ordering rule (SCRUM-120).
 *
 * The ordering test is the one that earns its place. `light ≥ moderate ≥ heavy` is enforced in
 * `PolicyVersionService` as a 400 and appears nowhere in the request's bean-validation
 * annotations — so a form that mirrored only `@DecimalMin` would look complete, pass review, and
 * still be rejected by the server. Nothing else on the client would catch that.
 *
 * @author Justin Chua
 */
import {
  ALL_THRESHOLD_KEYS,
  THRESHOLD_GRID,
  orderingHolds,
  thresholdsOf,
  type ThresholdKey,
} from "./policyThresholds";
import type { PolicyVersion } from "@/types/domain";

function values(overrides: Partial<Record<ThresholdKey, string>> = {}) {
  const base: Record<ThresholdKey, string> = {
    wbgtThresholdUnacclimatisedLight: "25.00",
    wbgtThresholdUnacclimatisedModerate: "23.00",
    wbgtThresholdUnacclimatisedHeavy: "21.00",
    wbgtThresholdPartialLight: "26.00",
    wbgtThresholdPartialModerate: "24.00",
    wbgtThresholdPartialHeavy: "22.00",
    wbgtThresholdFullLight: "28.00",
    wbgtThresholdFullModerate: "26.00",
    wbgtThresholdFullHeavy: "24.00",
  };
  return { ...base, ...overrides };
}

it("covers all nine thresholds, least acclimatised first", () => {
  expect(ALL_THRESHOLD_KEYS).toHaveLength(9);
  // A worker on day 2 is who the strictest thresholds protect; their row is read first.
  expect(THRESHOLD_GRID[0].level).toBe("UNACCLIMATISED");
  expect(THRESHOLD_GRID.map((row) => row.cells.map((cell) => cell.intensity))).toEqual([
    ["LIGHT", "MODERATE", "HEAVY"],
    ["LIGHT", "MODERATE", "HEAVY"],
    ["LIGHT", "MODERATE", "HEAVY"],
  ]);
});

it("accepts the MOM ladder", () => {
  expect(orderingHolds(values())).toBe(true);
});

it("accepts equal thresholds, since the rule is >= and not >", () => {
  expect(
    orderingHolds(
      values({
        wbgtThresholdPartialLight: "24.00",
        wbgtThresholdPartialModerate: "24.00",
        wbgtThresholdPartialHeavy: "24.00",
      }),
    ),
  ).toBe(true);
});

it("rejects a level where heavier work is allowed a higher threshold", () => {
  // Backwards: this would let someone doing heavy work carry on in heat that stops light work.
  expect(
    orderingHolds(values({ wbgtThresholdFullHeavy: "30.00" })),
  ).toBe(false);
});

it("rejects a break anywhere, not just the first level", () => {
  expect(orderingHolds(values({ wbgtThresholdUnacclimatisedModerate: "26.00" }))).toBe(false);
  expect(orderingHolds(values({ wbgtThresholdPartialHeavy: "25.00" }))).toBe(false);
});

it("leaves an incomplete set to the required-ness check", () => {
  // A blank field is a different message from a broken ladder, and reporting the ordering error
  // for an empty form would point the safety manager at the wrong problem.
  expect(orderingHolds(values({ wbgtThresholdFullLight: "" }))).toBe(true);
});

it("copies every threshold off an existing version as strings", () => {
  const version = {
    // Numbers, as the server sends them — the whole point of the assertion below.
    wbgtThresholdUnacclimatisedLight: 25,
    wbgtThresholdUnacclimatisedModerate: 23,
    wbgtThresholdUnacclimatisedHeavy: 21,
    wbgtThresholdPartialLight: 26,
    wbgtThresholdPartialModerate: 24,
    wbgtThresholdPartialHeavy: 22,
    wbgtThresholdFullLight: 28,
    wbgtThresholdFullModerate: 26,
    wbgtThresholdFullHeavy: 24,
    id: "v1",
    siteId: "s1",
    versionLabel: "MOM-WBGT-2026.1",
    source: "MOM",
    effectiveDate: "2026-08-01",
    status: "ACTIVE",
    wbgtEmergencyStop: 33,
    notes: null,
    createdBy: "u1",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    activatedAt: "2026-08-01T00:00:00Z",
    supersededAt: null,
  } as PolicyVersion;

  const copied = thresholdsOf(version);

  expect(Object.keys(copied)).toHaveLength(9);
  // Strings all the way through: the wire carries BigDecimal as a string, and a float round-trip
  // here would silently alter a safety threshold nobody authored.
  expect(Object.values(copied).every((value) => typeof value === "string")).toBe(true);
  // Stringified on the way into the form, which is what a TextInput can render.
  expect(copied.wbgtThresholdFullLight).toBe("28");
});
