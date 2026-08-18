/**
 * The tap target that opens the reading's explanation.
 *
 * ── WHY THIS IS A SEPARATE ELEMENT AND NOT THE FRESHNESS PILL ───────────────────────────
 * Making the pill itself tappable was the obvious version: it is already there, it already
 * says "Delayed", and it would be one element instead of two. It was rejected because
 * ADR-0017 makes a pill a reporting element that is never also a control — `ShiftStatusPill`
 * states outright that "there is no variant of it that is also a control, deliberately". A
 * carve-out here would apply to every pill in the app, and the whole benefit was saving one
 * small button.
 *
 * ── WHY IT IS NOT RENDERED ON A LIVE READING ────────────────────────────────────────────
 * A button that opens a dialog saying "everything is fine" teaches people that pressing it is
 * not worth the effort — and then they do not press it on the day it matters. Silence is the
 * correct output for a healthy reading, the same reasoning `FreshnessNotice` applies to its
 * own LIVE case.
 *
 * ── ACCESSIBILITY ───────────────────────────────────────────────────────────────────────
 * Colour is never the signal here. The pill beside this already carries the word — "Delayed",
 * "Stale" — so WCAG 1.4.1 is satisfied regardless of what the glyph looks like, and this
 * button only has to be reachable and honestly labelled. A screen reader user has no icon to
 * interpret, so the label says what tapping does rather than naming the picture.
 *
 * The hit area is padded well beyond the glyph: this is read at arm's length, in glare, by
 * someone who may be wearing gloves.
 *
 * @author Justin Chua
 */
import type { FC } from "react";
import { Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { s } from "react-native-size-matters";

import { useTheme } from "@/theme/ThemeProvider";
import type { WeatherStatusSubject } from "./WeatherStatusModal";

interface WeatherStatusButtonProps {
  subject: WeatherStatusSubject;
  onPress: () => void;
}

const WeatherStatusButton: FC<WeatherStatusButtonProps> = ({ subject, onPress }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  if (subject === "LIVE") return null;

  /*
   * Alert glyph for the two that qualify a reading someone might act on, information glyph for
   * the rest. Not a semantic colour ramp: the pill next to this already carries the tone, and
   * two coloured things saying the same thing is how a row stops having a focal point.
   */
  const icon = subject === "STALE" || subject === "DELAYED" ? "warning" : "information-circle";

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("weather.statusButtonLabel")}
      accessibilityHint={t("weather.statusButtonHint")}
      // Extends the touchable area without moving the glyph, so the button stays visually
      // small beside the pill while still clearing the minimum target size.
      hitSlop={s(10)}
      style={styles.button}
    >
      <Ionicons name={icon} size={s(18)} color={theme.colors.textSecondary} />
    </Pressable>
  );
};

export default WeatherStatusButton;

const styles = StyleSheet.create({
  button: {
    padding: s(4),
    marginLeft: s(6),
  },
});
