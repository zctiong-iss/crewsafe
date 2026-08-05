/**
 * The rest a worker still owes, as a bar and as a number (SCRUM-206).
 *
 * ── WHY BOTH ───────────────────────────────────────────────────────────────────────────
 * The bar is the pleasant version. The number is the copy that always exists.
 *
 * A bar alone answers "roughly how far through am I" and nothing else — it cannot be read
 * out by a screen reader, it says nothing at all when motion is suppressed at the OS level,
 * and at arm's length in glare a fill edge is harder to judge than two digits. So the
 * remaining time is always rendered as text, and the bar is what makes it feel like time
 * passing rather than a value being polled.
 *
 * ── ESSENTIAL MOTION ───────────────────────────────────────────────────────────────────
 * Exempt from the in-app Reduce Motion preference, still stopped by the OS setting. Same
 * carve-out `AnimatedIcon` defines for the stop-work pulse, and for the same reason:
 * SCRUM-199 made the in-app preference default to *on*, so without the exemption this bar
 * would be frozen for every worker who has never opened Settings — and a progress bar that
 * does not progress is a broken feature, not a calmer one.
 *
 * When the OS setting *is* on, the fill still updates, it simply jumps once a second instead
 * of gliding. Nothing is lost but the smoothness.
 */
import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppText from "../texts/AppText";
import { useSystemReduceMotion } from "@/hooks/useReduceMotion";
import { useNow } from "@/hooks/useNow";
import { formatRemaining } from "@/helpers/restDuration";
import { useTheme } from "@/theme/ThemeProvider";

interface RestProgressBarProps {
  /** Epoch ms the rest began — the acknowledgement. */
  startedAt: number;
  /** Epoch ms the rest ends. */
  dismissAt: number;
  /**
   * Called once, when the deadline passes.
   *
   * The card owns the clock, so the card is what notices. A clock at the list would have to
   * re-render every row once a second to discover that nothing had changed.
   */
  onComplete: () => void;
}

const RestProgressBar: FC<RestProgressBarProps> = ({ startedAt, dismissAt, onComplete }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const systemReduceMotion = useSystemReduceMotion();

  const now = useNow(1000);
  const remaining = Math.max(0, dismissAt - now);
  const total = Math.max(1, dismissAt - startedAt);
  const progress = Math.min(1, Math.max(0, (now - startedAt) / total));

  /*
   * Fired from an effect, not from the render body.
   *
   * Calling `onComplete` while rendering would dispatch during another component's render
   * phase, which React warns about and which can reorder against the tick that produced it.
   * The ref guard is what makes it *once*: `useNow` keeps ticking after the deadline, and
   * without it every subsequent second would fire again.
   */
  const completed = useRef(false);
  useEffect(() => {
    if (remaining <= 0 && !completed.current) {
      completed.current = true;
      onComplete();
    }
  }, [remaining, onComplete]);

  /*
   * `width` rather than a transform, so `useNativeDriver` is off here.
   *
   * A transform-based fill would run on the native thread, but it needs the track's measured
   * width to translate against, and that measurement is not available on the first frame —
   * the bar would visibly snap once layout landed. One interpolated width on one bar per
   * card is not the thing that will cost frames on this screen.
   */
  const fill = useRef(new Animated.Value(progress)).current;

  useEffect(() => {
    if (systemReduceMotion) {
      // Step, do not glide. The value still tracks time; only the easing between ticks goes.
      fill.setValue(progress);
      return;
    }
    // Slightly longer than the tick so each second's animation is still running when the
    // next begins. A duration equal to the interval leaves a stutter at every boundary.
    const animation = Animated.timing(fill, {
      toValue: progress,
      duration: 1100,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, systemReduceMotion, fill]);

  const width = fill.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
    extrapolate: "clamp",
  });

  return (
    <View
      style={styles.container}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
      accessibilityLabel={t("inbox.restRemaining", { time: formatRemaining(remaining) })}
    >
      <View
        style={[
          styles.track,
          {
            backgroundColor: theme.colors.surfaceAlt,
            borderColor: theme.colors.border,
            borderWidth: theme.metrics.borderWidth,
            borderRadius: s(999),
          },
        ]}
      >
        <Animated.View
          style={[
            styles.fill,
            { width, backgroundColor: theme.colors.success, borderRadius: s(999) },
          ]}
        />
      </View>

      {/* Always rendered. See the note at the top of this file — the bar is the nice
          version, this is the one that survives glare, a screen reader, and an OS that has
          been told to stop animating things. */}
      <AppText variant="caption" tone="secondary" style={styles.remaining}>
        {t("inbox.restRemaining", { time: formatRemaining(remaining) })}
      </AppText>
    </View>
  );
};

export default RestProgressBar;

const styles = StyleSheet.create({
  container: {
    marginTop: vs(10),
  },
  track: {
    height: vs(10),
    width: "100%",
    overflow: "hidden",
    justifyContent: "center",
  },
  fill: {
    height: "100%",
  },
  remaining: {
    marginTop: vs(6),
  },
});
