/**
 * An inline message with a tone and an optional request id to quote in a bug report.
 *
 * @author Justin Chua
 */
import { StyleSheet, View } from "react-native";
import type { FC } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";
import AppText from "../texts/AppText";
import AnimatedIcon, { type IconMotion } from "./AnimatedIcon";
import { useTheme } from "@/theme/ThemeProvider";

export type BannerTone = "danger" | "warning" | "info" | "success";

interface MessageBannerProps {
  /** Already-translated text. */
  message: string;
  tone?: BannerTone;
  /** The X-Request-Id to quote when reporting a failure. Rendered small, below. */
  requestId?: string | null;
  /** For tests that need the container itself rather than the text inside it. */
  testID?: string;
  /**
   * Centres the icon and message as a group, instead of left-aligning them across the banner's
   * full width.
   *
   * Opt-in rather than the default, because centring only flatters a short message. Most
   * banners here carry an error and often a request id beneath it, and centred body text gives
   * a ragged left edge that is measurably slower to scan — the wrong trade when someone is
   * reading a failure. A two-line notice sitting alone in a card is the case where the
   * left-aligned block looks stranded instead, which is what this is for.
   */
  align?: "start" | "center";
}

const ICONS: Record<BannerTone, keyof typeof Ionicons.glyphMap> = {
  danger: "alert-circle",
  warning: "warning",
  info: "information-circle",
  success: "checkmark-circle",
};

/**
 * Tempo carries meaning before the words do.
 *
 * A worker glancing at the phone should be able to tell a failure from a note without
 * reading — so danger insists, warning nudges, info merely breathes, and success pops once
 * and stops. Giving all four the same motion would spend the attention budget uniformly and
 * leave nothing standing out, which is the usual failure mode of animating everything.
 */
const MOTIONS: Record<BannerTone, IconMotion> = {
  danger: "urgent",
  warning: "steady",
  info: "breathe",
  success: "pop",
};

/**
 * An inline message. Used for sign-in failures and, later, for data-freshness notices.
 *
 * Carries an icon as well as a colour, because colour alone fails twice over here: for a
 * colour-blind user, and in direct sun where the tint washes out of a light fill. The icon
 * and the border survive both.
 */
const MessageBanner: FC<MessageBannerProps> = ({
  message,
  tone = "danger",
  requestId,
  testID,
  align = "start",
}) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const toneColor: Record<BannerTone, string> = {
    danger: theme.colors.danger,
    warning: theme.colors.warning,
    info: theme.colors.textPrimary,
    success: theme.colors.success,
  };

  const color = toneColor[tone];

  return (
    <View
      testID={testID}
      // Announced as a unit, and as an alert when it is one, so a screen reader does not
      // read the icon and the text as two unrelated stops.
      accessibilityRole={tone === "danger" ? "alert" : "text"}
      accessibilityLabel={message}
      style={[
        styles.container,
        align === "center" ? styles.containerCentered : null,
        {
          borderColor: color,
          borderWidth: theme.metrics.borderWidth,
          borderRadius: theme.metrics.radius,
          backgroundColor: theme.colors.surface,
        },
      ]}
    >
      <AnimatedIcon
        name={ICONS[tone]}
        size={s(20)}
        color={color}
        motion={MOTIONS[tone]}
        style={styles.icon}
      />

      {/* flex:1 is what keeps a long message wrapping inside the banner instead of
          stretching it past its parent. */}
      <View style={align === "center" ? styles.bodyCentered : styles.body}>
        <AppText
          variant="label"
          style={[{ color }, align === "center" ? styles.textCentered : null]}
        >
          {message}
        </AppText>
        {requestId ? (
          <AppText variant="caption" tone="secondary" style={styles.requestId}>
            {t("common.requestReference", { requestId })}
          </AppText>
        ) : null}
      </View>
    </View>
  );
};

export default MessageBanner;

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    /*
     * Centred against the whole message, not pinned to its first line.
     *
     * `flex-start` is right for a one-line banner and wrong for a wrapped one: the icon strands
     * itself at the top of a four-line block with empty space beneath it, which reads as a
     * layout fault rather than as an icon labelling a message. Centring costs nothing on a
     * single line — there is nothing to centre against — and fixes every longer one.
     */
    alignItems: "center",
    padding: s(12),
    width: "100%",
  },
  icon: {
    marginEnd: s(10),
  },
  containerCentered: {
    justifyContent: "center",
  },
  body: {
    flex: 1,
  },
  bodyCentered: {
    // Shrinks to the text rather than filling the row, so `justifyContent` above has something
    // to centre. With flex:1 the column would still span the full width and the text would
    // centre inside it, leaving the icon stranded at the far edge.
    flexShrink: 1,
  },
  textCentered: {
    textAlign: "center",
  },
  requestId: {
    marginTop: vs(4),
  },
});
