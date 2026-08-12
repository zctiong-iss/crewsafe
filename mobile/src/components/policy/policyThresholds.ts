/**
 * The nine thresholds, as a grid rather than nine field names (SCRUM-120).
 *
 * The server's record spells each one out — `wbgtThresholdPartialHeavy` and so on — which is right
 * for a wire contract and wrong for a screen: rendering it means writing the same row three times
 * and the same field name twice, once to read and once to write. One table here means the detail
 * view, the create form and their validation all walk the same nine cells in the same order, and
 * adding a tenth is one line rather than four edits in three files.
 *
 * @author Justin Chua
 */
import type { AcclimatisationLevel, PolicyVersion } from "@/types/domain";
import type { PolicyVersionInput } from "@/api/endpoints/policyVersions";

/** The keys shared by the response and the create request — the nine threshold fields. */
export type ThresholdKey = Extract<
  keyof PolicyVersionInput,
  | "wbgtThresholdUnacclimatisedLight"
  | "wbgtThresholdUnacclimatisedModerate"
  | "wbgtThresholdUnacclimatisedHeavy"
  | "wbgtThresholdPartialLight"
  | "wbgtThresholdPartialModerate"
  | "wbgtThresholdPartialHeavy"
  | "wbgtThresholdFullLight"
  | "wbgtThresholdFullModerate"
  | "wbgtThresholdFullHeavy"
>;

export interface ThresholdRow {
  level: AcclimatisationLevel;
  /** Light first, then moderate, then heavy — the order the server's ordering rule reads in. */
  cells: { intensity: "LIGHT" | "MODERATE" | "HEAVY"; key: ThresholdKey }[];
}

/**
 * Least acclimatised first.
 *
 * Deliberate: a worker on day 2 is the one the strictest thresholds protect, and putting them at
 * the top means the number that matters most is the one read first rather than the one scrolled
 * past.
 */
export const THRESHOLD_GRID: ThresholdRow[] = [
  {
    level: "UNACCLIMATISED",
    cells: [
      { intensity: "LIGHT", key: "wbgtThresholdUnacclimatisedLight" },
      { intensity: "MODERATE", key: "wbgtThresholdUnacclimatisedModerate" },
      { intensity: "HEAVY", key: "wbgtThresholdUnacclimatisedHeavy" },
    ],
  },
  {
    level: "PARTIAL",
    cells: [
      { intensity: "LIGHT", key: "wbgtThresholdPartialLight" },
      { intensity: "MODERATE", key: "wbgtThresholdPartialModerate" },
      { intensity: "HEAVY", key: "wbgtThresholdPartialHeavy" },
    ],
  },
  {
    level: "FULL",
    cells: [
      { intensity: "LIGHT", key: "wbgtThresholdFullLight" },
      { intensity: "MODERATE", key: "wbgtThresholdFullModerate" },
      { intensity: "HEAVY", key: "wbgtThresholdFullHeavy" },
    ],
  },
];

export const ALL_THRESHOLD_KEYS: ThresholdKey[] = THRESHOLD_GRID.flatMap((row) =>
  row.cells.map((cell) => cell.key),
);

/** Server bounds, mirrored so a 400 is unreachable in normal use. */
export const THRESHOLD_MIN = 15;
export const EMERGENCY_MIN = 20;
export const EMERGENCY_MAX = 40;
export const MAX_LABEL = 64;
export const MAX_SOURCE = 255;

/**
 * Every threshold from an existing version, as the form's string fields.
 *
 * The wire carries `BigDecimal` as a JSON number and the form edits strings, so each value is
 * stringified once, here. Nothing is re-parsed on the way back out: what the safety manager typed
 * is what is sent, so no rounding can alter a threshold they never touched.
 */
export function thresholdsOf(version: PolicyVersion): Record<ThresholdKey, string> {
  return ALL_THRESHOLD_KEYS.reduce(
    (acc, key) => {
      // Stringified here, at the one place the wire meets the form. The response carries
      // numbers; a TextInput needs a string, and `value={25}` renders as nothing at all.
      acc[key] = String(version[key]);
      return acc;
    },
    {} as Record<ThresholdKey, string>,
  );
}

/**
 * The server's ordering rule: within a level, light ≥ moderate ≥ heavy.
 *
 * Enforced in `PolicyVersionService` as a 400 rather than by a column constraint, and not visible
 * in the request's annotations at all — so a form that only checked `@DecimalMin` would look
 * complete and still be rejected. Harder work needs a lower threshold, which is why the ladder
 * runs downwards.
 */
export function orderingHolds(values: Record<ThresholdKey, string>): boolean {
  return THRESHOLD_GRID.every((row) => {
    const raw = row.cells.map((cell) => values[cell.key]);
    /*
     * A blank field is not a broken ladder — it is a missing value, and the required-ness check
     * reports it with the right message. Tested against `Number()` rather than assumed: `Number("")`
     * is 0, not NaN, so an empty field would otherwise compare as a threshold of zero and fail the
     * ordering rule, pointing the safety manager at the wrong problem entirely.
     */
    if (raw.some((value) => value.trim() === "")) return true;

    const [light, moderate, heavy] = raw.map(Number);
    if ([light, moderate, heavy].some(Number.isNaN)) return true;
    return light >= moderate && moderate >= heavy;
  });
}
