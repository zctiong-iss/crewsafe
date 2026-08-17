/**
 * The app's button. Owns its own label layout — see the note on `titleFill`, which
 * exists because Android broke a two-word label at the space and clipped the second line.
 *
 * @author Justin Chua
 */
import {
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useState, type FC, type ReactNode } from "react";
import { s, vs } from "react-native-size-matters";
import AppText from "../texts/AppText";
import { useTheme } from "@/theme/ThemeProvider";

export type AppButtonVariant = "primary" | "secondary" | "danger";

interface AppButtonProps {
  onPress: () => void;
  title: string;
  variant?: AppButtonVariant;
  disabled?: boolean;
  /** Shows a spinner and blocks presses. Keeps the label, so the button does not resize. */
  loading?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  styleTitle?: StyleProp<TextStyle>;
  accessibilityHint?: string;
}

const AppButton: FC<AppButtonProps> = ({
  onPress,
  title,
  variant = "primary",
  disabled = false,
  loading = false,
  icon,
  style,
  styleTitle,
  accessibilityHint,
}) => {
  const theme = useTheme();
  const isInactive = disabled || loading;

  /*
   * Tracked only so `danger` can fill on engage. `primary` and `secondary` ignore it and
   * keep the steady fill they have always had — `activeOpacity` remains their press cue.
   */
  const [pressed, setPressed] = useState(false);

  const palette: Record<AppButtonVariant, { background: string; border: string; text: string }> = {
    primary: {
      background: theme.colors.primary,
      border: theme.colors.primary,
      text: theme.colors.onPrimary,
    },
    secondary: {
      background: theme.colors.surface,
      border: theme.colors.borderStrong,
      text: theme.colors.textPrimary,
    },
    /*
     * Destructive: outlined at rest, filled on press (ADR-0017 §5).
     *
     * Cancelling a shift or rejecting a plan should not be the same weight of tap as
     * confirming one. Outlined at rest, the button reads as available but not inviting; the
     * fill arrives under the thumb, so committing is something you watch yourself do. Mirrors
     * the shipped web `.shift-form__danger` hover treatment.
     *
     * The swap is an instant colour change with no animated transition, which makes it safe
     * under Reduce Motion by construction rather than by honouring a preference.
     */
    danger: pressed
      ? {
          background: theme.colors.danger,
          border: theme.colors.danger,
          text: theme.colors.textInverse,
        }
      : {
          background: theme.colors.surface,
          border: theme.colors.danger,
          text: theme.colors.danger,
        },
  };

  const active = palette[variant];

  /*
   * Whether anything sits to the left of the label, which decides how the label is sized.
   * See `titleFill` for the measured reason the two cases differ.
   */
  const hasLeading = loading || Boolean(icon);

  return (
    <TouchableOpacity
      onPress={onPress}
      /*
       * Cleared on press-out as well as on release, so a drag off the button leaves it
       * outlined rather than stuck filled — a destructive button that still looks engaged
       * after you moved your thumb away reads as though it fired.
       */
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      activeOpacity={0.8}
      disabled={isInactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: isInactive, busy: loading }}
      accessibilityHint={accessibilityHint}
      style={[
        styles.button,
        {
          backgroundColor: isInactive ? theme.colors.disabled : active.background,
          borderColor: isInactive ? theme.colors.disabled : active.border,
          borderWidth: theme.metrics.borderWidth,
          borderRadius: theme.metrics.radius,
          // Grows with the text setting, so a large-text user does not get a clipped label.
          minHeight: Math.max(theme.metrics.minTouchTarget, vs(44) * theme.fontScale),
        },
        style,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator
            size="small"
            color={isInactive ? theme.colors.onDisabled : active.text}
            style={styles.spinner}
          />
        ) : (
          icon && <View style={styles.icon}>{icon}</View>
        )}
        {/*
          The label is wrapped, and the wrapper is what flexes — never the Text.

          A `Text` that is itself the flex-sizing node gets its box sized to its own measured
          content, and Android then lays the string out inside a box that can be a hair
          narrower than the width Yoga reported. It breaks the line at a space and, because
          the box is only one line tall, silently drops everything after the break.
        */}
        <View style={hasLeading ? styles.titleWrap : styles.titleFill}>
          <AppText
            variant="label"
            style={[
              styles.title,
              { color: isInactive ? theme.colors.onDisabled : active.text },
              styleTitle,
            ]}
          >
            {title}
          </AppText>
        </View>
      </View>
    </TouchableOpacity>
  );
};

export default AppButton;

const styles = StyleSheet.create({
  button: {
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "center",
    paddingHorizontal: s(16),
    paddingVertical: vs(10),
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    /*
     * A definite width rather than shrink-to-fit.
     *
     * The row previously sized to its own content, which made the width available to the
     * label depend on when the row happened to be measured. That is not stable inside a
     * virtualised list.
     */
    width: "100%",
  },
  /*
   * ── WHY THE LABEL TAKES THE WHOLE ROW WHEN IT CAN ───────────────────────────────────────
   * Measured on a 1344x2992 @480dpi emulator, Malay inbox, three identical buttons:
   *
   *   Yoga measured the label at 97.33dp x 24.3dp — one line, full width of "Akui terima".
   *   Android's accessibility tree agreed: text="Akui terima", bounds 292px wide.
   *   The screen drew "Akui", centred, on every card except the first.
   *
   * The string was never truncated and the node was never wrong. Android was handed a text
   * box sized to the label's own measured width, decided the line needed marginally more
   * than that, and broke at the space. The box is one line tall because Yoga measured one
   * line, so the second line was clipped — and `textAlign: center` re-centred the survivor,
   * which is what disguised a clipped line as a shorter string.
   *
   * Proof it was the line break and not the width, the font, the list or the locale: the
   * same glyphs with the space removed ("Akuiterima") rendered in full on every card.
   *
   * `flex: 1` gives the label a box derived from the button's width instead of from its own
   * content, so there is nothing marginal to get wrong. Two device-independent pixels of
   * slack were tried first and did not fix it, which is what ruled out simple rounding.
   *
   * English hid this for the life of the app: "Acknowledge" is one word with nowhere to
   * break. It took a two-word label to surface, and a narrower device — a Fold rendered the
   * same bundle correctly beside an XL that did not.
   */
  titleFill: {
    flex: 1,
  },
  /*
   * The icon case keeps the old shrink-to-fit sizing, so an icon still sits beside its label
   * as a centred pair rather than being pushed to the far edge by a full-width label.
   *
   * That leaves icon buttons theoretically exposed to the bug above. They are not exposed in
   * practice: every one of them lives on a plain ScrollView screen — Profile, Settings,
   * sign-in, the shift-list header — and none is rendered inside a recycled `FlatList` cell,
   * which is where the width instability comes from. **If an icon button is ever put inside
   * a virtualised list, give it `titleFill` and find another way to keep the icon adjacent.**
   */
  titleWrap: {
    flexShrink: 1,
  },
  title: {
    textAlign: "center",
    // Deliberately no flex properties. Giving the Text itself a flex role is the defect
    // described above; it inherits a settled width from its wrapper and wraps inside it.
  },
  icon: {
    marginEnd: s(8),
  },
  spinner: {
    marginEnd: s(8),
  },
});
