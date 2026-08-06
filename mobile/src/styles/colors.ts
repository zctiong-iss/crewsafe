/**
 * Two palettes, one shape.
 *
 * CrewSafe is used outdoors, in Singapore, by people wearing safety glasses and holding a
 * phone at arm's length in direct sun. The standard palette is the black-and-white theme
 * carried over from the reference app; the high-contrast palette is what makes the app
 * legible at midday, and it is a safety feature rather than a preference — a worker who
 * cannot read a stop-work banner is not warned.
 *
 * High contrast is not "the same colours, darker". Every mid-grey is collapsed to pure
 * black, because grey-on-white is the first thing to disappear under glare. Semantic
 * colours are darkened until they clear WCAG AA (4.5:1) against white, so a red that means
 * "danger" still reads as red and still reads as text.
 *
 * @author Justin Chua
 */
export interface AppPalette {
  /** Screen background. */
  background: string;
  /** Cards and raised surfaces. */
  surface: string;
  /** Subtle banding — list rows, section fills. Collapses to `surface` in high contrast. */
  surfaceAlt: string;

  textPrimary: string;
  /** Supporting copy. Collapses to `textPrimary` in high contrast. */
  textSecondary: string;
  /** Text on a `primary` fill. */
  textInverse: string;
  /**
   * Placeholder text inside an empty field.
   *
   * Never `textPrimary`, even in high contrast: a placeholder that looks identical to a
   * real value makes an empty required field read as filled, and the user finds out at
   * submit. Kept above 4.5:1 on `surface` so it is legible, but visibly lighter than an
   * actual entry.
   */
  placeholder: string;
  /** Label on a `disabled` fill. Never `textInverse` — see the standard palette below. */
  onDisabled: string;

  border: string;
  borderStrong: string;

  primary: string;
  onPrimary: string;

  /** Stop-work, validation failures, destructive actions. */
  danger: string;
  /** Advisory lightning risk, stale data, degraded states. */
  warning: string;
  /**
   * `warning` darkened until white text clears AA on top of it.
   *
   * Exists because `warning` is the one semantic colour that cannot carry white text.
   * Measured against white: `#B26A00` is 4.24:1 — under the 4.5:1 floor for normal text —
   * while `danger` (5.79:1) and `success` (7.87:1) both pass comfortably. So the filled
   * lightning advisory banner needed a fill that the others did not.
   *
   * Only ever a *fill*. `warning` remains the colour for warning text and borders on a
   * light surface, where it is the value that has already been checked in the other
   * direction. Two names because they solve opposite problems: one is legible *on* white,
   * the other is legible *under* it.
   */
  warningFill: string;
  /** Acknowledged, fresh, healthy. */
  success: string;
  /** Simulated / mocked data badges. Never used for a real reading. */
  simulated: string;

  disabled: string;
  overlay: string;
}

const standard: AppPalette = {
  background: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceAlt: "#F6F6F6",

  textPrimary: "#000000",
  textSecondary: "#4A4A4A",
  textInverse: "#FFFFFF",
  placeholder: "#6B6B6B",
  // White on #D3D3D3 is about 1.4:1 — a disabled button's label would be invisible, which
  // reads as a broken button rather than an inactive one. Dark-on-grey gives ~7:1.
  onDisabled: "#3A3A3A",

  border: "#CCCCCC",
  borderStrong: "#000000",

  primary: "#000000",
  onPrimary: "#FFFFFF",

  danger: "#C71A34",
  warning: "#B26A00",
  // 5.43:1 with white, against 4.24:1 for `warning` itself. Darkened only as far as AA
  // needs — far enough to be legal, not so far that the advisory stops reading as amber
  // and starts reading as brown.
  warningFill: "#9A5B00",
  success: "#1B5E20",
  simulated: "#5A4B8C",

  disabled: "#D3D3D3",
  overlay: "rgba(0, 0, 0, 0.45)",
};

const highContrast: AppPalette = {
  background: "#FFFFFF",
  surface: "#FFFFFF",
  // Banding relies on a fill difference too subtle to survive glare. In high contrast the
  // borders do that job instead — see `metrics.borderWidth`.
  surfaceAlt: "#FFFFFF",

  textPrimary: "#000000",
  textSecondary: "#000000",
  textInverse: "#FFFFFF",
  // The one grey high contrast keeps. 7:1 on white — legible in sun, but unmistakably not
  // an entered value, which is the whole job of a placeholder.
  placeholder: "#595959",
  // White on #767676 is 4.2:1 and misses AA; black on it is 5:1 and passes.
  onDisabled: "#000000",

  border: "#000000",
  borderStrong: "#000000",

  primary: "#000000",
  onPrimary: "#FFFFFF",

  // Darkened until each clears 4.5:1 on white, so meaning survives without colour alone
  // carrying it.
  danger: "#B3001B",
  warning: "#7A4600",
  // Already 7.77:1 with white — high contrast darkens every semantic colour until it clears
  // AA *on* white, and that happens to make it safe *under* white too. No separate value
  // needed here; the field exists so the two palettes keep the same shape.
  warningFill: "#7A4600",
  success: "#0B3D0B",
  simulated: "#3D2E75",

  // #D3D3D3 on white is ~1.4:1 — invisible outdoors, and "disabled" would read as "missing".
  // #767676 is the lightest grey that still clears AA.
  disabled: "#767676",
  overlay: "rgba(0, 0, 0, 0.75)",
};

export const palettes = { standard, highContrast } as const;

/** Kept for parity with the reference app's import style. Prefer `useTheme().colors`. */
export const AppColors = standard;
