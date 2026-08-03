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
const MessageBanner: FC<MessageBannerProps> = ({ message, tone = "danger", requestId }) => {
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
      // Announced as a unit, and as an alert when it is one, so a screen reader does not
      // read the icon and the text as two unrelated stops.
      accessibilityRole={tone === "danger" ? "alert" : "text"}
      accessibilityLabel={message}
      style={[
        styles.container,
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
      <View style={styles.body}>
        <AppText variant="label" style={{ color }}>
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
    alignItems: "flex-start",
    padding: s(12),
    width: "100%",
  },
  icon: {
    marginEnd: s(10),
    // Nudges the icon onto the first line's optical centre. Without it the icon sits high
    // against a wrapped, multi-line message.
    marginTop: vs(1),
  },
  body: {
    flex: 1,
  },
  requestId: {
    marginTop: vs(4),
  },
});
