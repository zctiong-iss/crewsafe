/**
 * The live / delayed / stale / simulated marker FR-12 requires on every weather reading.
 *
 * Not decoration. A worker deciding whether to keep going in the heat is entitled to know
 * whether the number they are looking at was measured four minutes ago or is a demo
 * fixture, and §12.2 requires every weather response to carry the freshness that drives it.
 *
 * @author Justin Chua
 */
import { StyleSheet, View } from "react-native";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";
import AppText from "../texts/AppText";
import { useTheme } from "@/theme/ThemeProvider";
import type { WeatherQualityStatus } from "@/types/domain";

const FreshnessBadge: FC<{ status: WeatherQualityStatus }> = ({ status }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const color: Record<WeatherQualityStatus, string> = {
    LIVE: theme.colors.success,
    DELAYED: theme.colors.warning,
    STALE: theme.colors.danger,
    // Its own colour, not reused from warning or danger: simulated data is not degraded
    // data, and conflating them would make a demo look like a fault.
    SIMULATED: theme.colors.simulated,
  };

  return (
    <View
      style={[
        styles.badge,
        {
          borderColor: color[status],
          borderWidth: theme.metrics.borderWidth,
          borderRadius: theme.metrics.radius / 2,
        },
      ]}
    >
      <AppText variant="caption" style={{ color: color[status] }}>
        {t(`freshness.${status}`)}
      </AppText>
    </View>
  );
};

export default FreshnessBadge;

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: s(8),
    paddingVertical: vs(2),
    alignSelf: "flex-start",
  },
});
