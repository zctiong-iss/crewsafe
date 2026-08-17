/**
 * The app's one pill/chip — three roles, one shape (ADR-0017 §4).
 *
 * ── WHY ONE COMPONENT ───────────────────────────────────────────────────────────────────
 * Five hand-rolled pills grew independently (`RecommendationStatusPill`, `ShiftStatusPill`,
 * `PolicyStatusPill`, `FreshnessBadge`, and the inline origin pill in `MitigationRow`), each
 * with its own padding and radius. A consistent grammar is learnable; five near-misses are
 * noise. The shape here — `radius / 2`, `alignSelf: flex-start`, caption text — is lifted
 * from the shipped `RecommendationStatusPill`, so migrating the others is a move, not a
 * redesign.
 *
 * ── THE THREE ROLES ARE NOT INTERCHANGEABLE ─────────────────────────────────────────────
 * STATE is FILLED and is spent on the ONE status actively asking for a decision right now
 * ("Awaiting decision"). ATTRIBUTE is OUTLINED and classifies the item (Required/Suggested).
 * ENTITY is a NEUTRAL fill naming an identity (a worker) and never carries semantic colour.
 *
 * The temptation is to fill the Required pill too, because "required" feels urgent. Don't:
 * most actions are mandatory, so filling every one drowns the single pill that needs a
 * supervisor's attention. That is the whole argument of ADR-0017 §4 and it is load-bearing.
 *
 * ── WHY ENTITY IS ALWAYS BORDERED ───────────────────────────────────────────────────────
 * In high contrast `surfaceAlt` collapses to `surface` (both `#FFFFFF`), so a fill-only chip
 * would vanish exactly when a supervisor is reading under glare. The border carries the
 * chip's edge when the fill cannot: `#CCCCCC` in standard, `#000000` in high contrast.
 *
 * ── WHY `tone` IS A CLOSED UNION ────────────────────────────────────────────────────────
 * Deviation from the design doc's §8.1 code block, which types `tone` as a free-form string
 * holding a theme colour. That lets any caller pass any colour, which leaves D3 — reserve
 * colour for meaning — enforced only by code review. Naming a *meaning* and resolving the
 * colour here means the type checker holds the line instead. See the ADR-0017 addendum.
 *
 * @author Justin Chua
 */
import { StyleSheet, View } from "react-native";
import type { FC } from "react";
import { s, vs } from "react-native-size-matters";

import AppText from "@/components/texts/AppText";
import { useTheme } from "@/theme/ThemeProvider";

export type PillRole = "state" | "attribute" | "entity";

/**
 * The meanings a pill may carry — never a raw colour.
 *
 * Mirrors the semantic slots in `AppPalette`. `neutral` is the default and resolves to
 * `textSecondary`, which is the "this classifies something, but it is not a signal" case.
 */
export type PillTone = "neutral" | "danger" | "warning" | "success" | "info";

interface PillProps {
  role: PillRole;
  label: string;
  /**
   * Fills a `state` pill, outlines and colours an `attribute` pill.
   *
   * Ignored entirely for `entity` — an identity is not a signal, and a worker's name must
   * never render in hazard red because of who they are.
   */
  tone?: PillTone;
}

const Pill: FC<PillProps> = ({ role, label, tone = "neutral" }) => {
  const theme = useTheme();

  /*
   * `info` maps to `primary` rather than a blue: the mobile chrome is monochrome by D3, and
   * introducing a blue here would be the first decorative colour in the palette.
   */
  const toneColors: Record<PillTone, string> = {
    neutral: theme.colors.textSecondary,
    danger: theme.colors.danger,
    warning: theme.colors.warning,
    success: theme.colors.success,
    info: theme.colors.primary,
  };

  const accent = toneColors[tone];

  let surface: { backgroundColor: string; borderColor: string };
  let textColor: string;

  if (role === "state") {
    surface = { backgroundColor: accent, borderColor: accent };
    textColor = theme.colors.textInverse;
  } else if (role === "attribute") {
    surface = { backgroundColor: "transparent", borderColor: accent };
    textColor = accent;
  } else {
    // Entity: neutral fill, always bordered — `surfaceAlt` collapses to `surface` in high
    // contrast, so the border is the only thing left holding the chip's edge.
    surface = {
      backgroundColor: theme.colors.surfaceAlt,
      borderColor: theme.colors.border,
    };
    textColor = theme.colors.textPrimary;
  }

  return (
    <View
      style={[
        styles.pill,
        surface,
        {
          borderWidth: theme.metrics.borderWidth,
          borderRadius: theme.metrics.radius / 2,
        },
      ]}
    >
      {/*
        Through `AppText` so the per-script line-height boost applies — Tamil, Bengali and
        Myanmar clip inside a caption-height box without it.

        Deliberately NOT `numberOfLines={1}`: the pill this replaces carried `maxWidth: s(110)`
        and truncated "Required" at fontScale 1.5. A pill sizes to its content and wraps.
      */}
      <AppText variant="caption" style={[styles.label, { color: textColor }]}>
        {label}
      </AppText>
    </View>
  );
};

export default Pill;

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: s(8),
    paddingVertical: vs(2),
    alignSelf: "flex-start",
    // A row rather than a bare box, so the pill sizes to the whole label instead of to its
    // first break opportunity.
    flexDirection: "row",
    alignItems: "center",
    maxWidth: "100%",
  },
  label: { flexShrink: 1 },
});
