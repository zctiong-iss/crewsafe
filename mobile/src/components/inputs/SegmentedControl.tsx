/**
 * A horizontal segmented picker for small, mutually exclusive choices.
 *
 * @author Justin Chua
 */
import { StyleSheet, TouchableOpacity, View } from "react-native";
import { s, vs } from "react-native-size-matters";
import AppText from "../texts/AppText";
import { useTheme } from "@/theme/ThemeProvider";

interface SegmentedControlProps<T extends string> {
  label?: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (next: T) => void;
  errorMessage?: string;
  /**
   * The fill for the selected segment, when the choice itself carries a colour (SCRUM-266).
   *
   * Optional and per-value rather than a single `selectedColor`, because the cases that want
   * this want a *ramp* — work intensity runs green → amber → red — and a control that only
   * accepted one colour would have had each caller re-implement the mapping.
   *
   * Whatever is returned must carry `onPrimary` (white) at AA. The label stays white in every
   * case, so a light fill would make the selected option the one nobody can read.
   */
  selectedColorFor?: (value: T) => string;
}

/**
 * A small set of mutually exclusive choices, laid out horizontally.
 *
 * Used for work intensity, where three vertical radio rows per worker would make a
 * three-person crew a very long scroll.
 *
 * The row wraps rather than squeezing. At a large text setting three segments no longer fit
 * across a phone, and a fixed row would clip the labels instead of reflowing them — the
 * failure being avoided is a supervisor choosing "Mod…" because the word did not fit.
 */
function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  errorMessage,
  selectedColorFor,
}: SegmentedControlProps<T>) {
  const theme = useTheme();
  const hasError = Boolean(errorMessage);

  return (
    <View style={styles.wrapper}>
      {label ? (
        <AppText variant="label" style={styles.label}>
          {label}
        </AppText>
      ) : null}

      <View
        style={styles.row}
        accessibilityRole="radiogroup"
        accessibilityLabel={hasError && label ? `${label}. ${errorMessage}` : label}
      >
        {options.map((option) => {
          const selected = option.value === value;
          /* Falls back to `primary`, so a caller that does not care keeps the black fill the
             rest of the app uses. */
          const selectedFill = selectedColorFor?.(option.value) ?? theme.colors.primary;
          let borderColor = theme.colors.borderStrong;
          if (hasError) borderColor = theme.colors.danger;
          else if (selected) borderColor = selectedFill;
          return (
            <TouchableOpacity
              key={option.value}
              onPress={() => onChange(option.value)}
              activeOpacity={0.8}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={[
                styles.segment,
                {
                  backgroundColor: selected ? selectedFill : theme.colors.surface,
                  /* The unselected border stays neutral. Tinting all three would show the
                     ramp before a choice has been made, which reads as three states being
                     active at once. */
                  borderColor,
                  borderWidth: theme.metrics.borderWidth,
                  borderRadius: theme.metrics.radius,
                  minHeight: theme.metrics.minTouchTarget,
                },
              ]}
            >
              <AppText
                variant="label"
                style={{
                  color: selected ? theme.colors.onPrimary : theme.colors.textPrimary,
                  textAlign: "center",
                }}
              >
                {option.label}
              </AppText>
            </TouchableOpacity>
          );
        })}
      </View>

      {hasError ? (
        <AppText variant="caption" tone="danger" style={styles.error}>
          {errorMessage}
        </AppText>
      ) : null}
    </View>
  );
}

export default SegmentedControl;

const styles = StyleSheet.create({
  wrapper: {
    width: "100%",
    marginBottom: vs(12),
  },
  label: {
    marginBottom: vs(6),
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    // Negative margin pairs with the per-segment margin so wrapped rows stay evenly spaced
    // without a trailing gap on the right.
    marginHorizontal: -s(3),
  },
  segment: {
    flexGrow: 1,
    // Enough for the longest label at default scale; below this they wrap instead.
    minWidth: s(92),
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: s(10),
    paddingVertical: vs(8),
    marginHorizontal: s(3),
    marginBottom: vs(6),
  },
  error: {
    marginTop: vs(2),
  },
});
