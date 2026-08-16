/**
 * @author Jemilin Beulah
 */

/** The nine threshold field names on PolicyVersion/PolicyVersionCreateRequest. */
export type ThresholdField =
  | "wbgtThresholdUnacclimatisedLight"
  | "wbgtThresholdUnacclimatisedModerate"
  | "wbgtThresholdUnacclimatisedHeavy"
  | "wbgtThresholdPartialLight"
  | "wbgtThresholdPartialModerate"
  | "wbgtThresholdPartialHeavy"
  | "wbgtThresholdFullLight"
  | "wbgtThresholdFullModerate"
  | "wbgtThresholdFullHeavy";

export interface ThresholdGroup {
  level: string;
  light: ThresholdField;
  moderate: ThresholdField;
  heavy: ThresholdField;
}

/**
 * The nine thresholds grouped by acclimatisation level, in the order the card, the form and
 * the validator all present them. One place for this shape so those three don't drift apart.
 */
export const THRESHOLD_GROUPS: readonly ThresholdGroup[] = [
  {
    level: "Unacclimatised",
    light: "wbgtThresholdUnacclimatisedLight",
    moderate: "wbgtThresholdUnacclimatisedModerate",
    heavy: "wbgtThresholdUnacclimatisedHeavy",
  },
  {
    level: "Partially acclimatised",
    light: "wbgtThresholdPartialLight",
    moderate: "wbgtThresholdPartialModerate",
    heavy: "wbgtThresholdPartialHeavy",
  },
  {
    level: "Fully acclimatised",
    light: "wbgtThresholdFullLight",
    moderate: "wbgtThresholdFullModerate",
    heavy: "wbgtThresholdFullHeavy",
  },
];
