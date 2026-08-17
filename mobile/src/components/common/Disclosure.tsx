/**
 * A labelled toggle that reveals content below it (ADR-0017 §7).
 *
 * ── WHY THIS IS `Disclosure` AND NOT `DisclosureCard` ───────────────────────────────────
 * §7 names the contract `DisclosureCard { summary; detail; defaultOpen? }`. The `summary` and
 * `detail` halves are exactly right and are kept; the *card* is not. Of the two places that
 * needed this, one (`MitigationRow`) is a row **inside** a card and one (`ShiftListScreen`) is
 * a section inside a list cell that is already a card. Neither wants a second card surface,
 * and forcing one would have meant a nested border in high contrast. What is genuinely shared
 * is the disclosure contract — the toggle, its accessible name, and the rule that detail does
 * not mount while closed. `cardSurface()` stays where it is; §7's own reuse table already
 * lists it separately.
 *
 * ── THE ACCESSIBLE NAME IS THE POINT ────────────────────────────────────────────────────
 * `ExpandChevron` replaces the words "Show crew" / "Hide crew" with a rotation, and a chevron
 * announces nothing. Every call site therefore has to supply an `accessibilityLabel` that
 * changes with state, and every call site is one `accessibilityLabel` away from shipping an
 * unlabelled button. Making it a required prop is most of why this component exists.
 *
 * ── CONTROLLED AND UNCONTROLLED, BOTH DELIBERATE ────────────────────────────────────────
 * `MitigationRow` owns its own state — the row is the only thing that cares. `ShiftListScreen`
 * cannot: its rows live in a `FlatList`, which unmounts them on scroll, so expansion is held
 * in a `Set` on the screen or it is lost the moment a supervisor scrolls away. §7 specifies
 * only `defaultOpen?`; the controlled pair is added because the list case is real.
 *
 * @author Justin Chua
 */
import { useState, type FC, type ReactNode } from "react";
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { s } from "react-native-size-matters";

import AppText from "@/components/texts/AppText";
import ExpandChevron from "@/components/feedback/ExpandChevron";
import { useTheme } from "@/theme/ThemeProvider";

interface DisclosureProps {
  /** The detail tier. Not mounted at all while closed — that is the whole point. */
  children: ReactNode;
  /** Visible text on the toggle. Takes `open` because some labels change with it. */
  label: (open: boolean) => string;
  /**
   * What a screen reader announces. Required: the chevron carries no words, so without this
   * the control reads as an unlabelled button.
   */
  accessibilityLabel: (open: boolean) => string;
  /** Uncontrolled starting state. Ignored when `open` is supplied. */
  defaultOpen?: boolean;
  /** Controlled state. Supply with `onToggle` when a parent must own expansion. */
  open?: boolean;
  onToggle?: (next: boolean) => void;
  /** Defaults to the caption-scale chevron used on the plan screen. */
  chevronSize?: number;
  /** Defaults to `textSecondary`. Pass `textPrimary` where the toggle is a primary control. */
  chevronColor?: string;
  /**
   * Layout overrides for the toggle row — spacing, and `justifyContent: "space-between"` where
   * the toggle spans a card and the chevron belongs at the far edge.
   *
   * Merged after the defaults, so a caller can widen the target but the theme's
   * `minTouchTarget` still applies unless it is deliberately overridden.
   */
  style?: StyleProp<ViewStyle>;
}

const Disclosure: FC<DisclosureProps> = ({
  children,
  label,
  accessibilityLabel,
  defaultOpen = false,
  open: controlledOpen,
  onToggle,
  chevronSize,
  chevronColor,
  style,
}) => {
  const theme = useTheme();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const toggle = () => {
    const next = !open;
    if (!isControlled) setUncontrolledOpen(next);
    onToggle?.(next);
  };

  return (
    <>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={accessibilityLabel(open)}
        hitSlop={8}
        style={[styles.toggle, { minHeight: theme.metrics.minTouchTarget }, style]}
      >
        <AppText variant="caption" tone="secondary">
          {label(open)}
        </AppText>
        <ExpandChevron
          expanded={open}
          /* Scaled with the text setting: an icon that stays 16px while the line beside it
             grows to 1.5x stops looking like part of the same control. */
          size={chevronSize ?? s(16) * theme.fontScale}
          color={chevronColor ?? theme.colors.textSecondary}
        />
      </Pressable>

      {open ? children : null}
    </>
  );
};

export default Disclosure;

const styles = StyleSheet.create({
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
    // `minHeight` comes from the theme, not a literal: high contrast raises the minimum to
    // 52pt for gloved hands on uneven ground.
  },
});
