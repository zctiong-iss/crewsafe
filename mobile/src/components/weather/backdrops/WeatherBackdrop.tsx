/**
 * The condition backdrop on the Weather hero card (SCRUM-209 Part 3).
 *
 * Draws whatever `registry.ts` says a condition looks like. It has no knowledge of any
 * individual condition, which is what makes swapping one a data change.
 *
 * ── THREE WAYS THIS DRAWS NOTHING, AND ALL OF THEM ARE CORRECT ──────────────────────────
 * High contrast, no spec, and a zero-size card. Each returns null rather than an empty
 * frame: a blank box reads as a broken asset, an absent one reads as a plain card.
 *
 * ── REDUCE MOTION IS OBEYED IN FULL, WITH NO `essential` CARVE-OUT ──────────────────────
 * `AnimatedIcon` has an `essential` escape hatch for motion that carries meaning — the
 * stop-work pulse, where the tempo *is* the warning. This is the opposite case. The icon
 * and the label already say "Rain"; the movement is atmosphere and nothing reads it. Taking
 * the exemption here would weaken the argument that protects the one place it matters.
 *
 * The consequence, and it is the common case rather than an edge one: SCRUM-199 defaults
 * the preference to on, so most workers see the still backdrop. That is why every spec is
 * authored to look finished without motion — the wash and every mote still render, fixed at
 * their base position. The still is the feature; the animation is the enhancement.
 *
 * @author Justin Chua
 */
import { useEffect, useRef, useState, type FC } from "react";
import { Animated, Easing, Platform, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useIsFocused } from "@react-navigation/native";

import { useReduceMotion } from "@/hooks/useReduceMotion";
import { useTheme } from "@/theme/ThemeProvider";
import type { WeatherCondition } from "@/types/domain";
import { backdropFor } from "./registry";
import type { BackdropMote } from "./types";

interface WeatherBackdropProps {
  condition: WeatherCondition;
  night: boolean;
  /** Matches the card's own radius so the wash cannot square off its corners. */
  radius: number;
}

export function moteFingerprint(mote: BackdropMote): string {
  return JSON.stringify({
    x: mote.x,
    y: mote.y,
    size: mote.size,
    aspect: mote.aspect ?? null,
    color: mote.color,
    opacity: mote.opacity,
    motion: mote.motion,
    duration: mote.duration ?? null,
    delay: mote.delay ?? null,
    rounding: mote.rounding ?? null,
  });
}

export function moteKeys(motes: readonly BackdropMote[]): string[] {
  const occurrences = new Map<string, number>();
  return motes.map((mote) => {
    const fingerprint = moteFingerprint(mote);
    const occurrence = occurrences.get(fingerprint) ?? 0;
    occurrences.set(fingerprint, occurrence + 1);
    return `mote:${fingerprint}:occurrence:${occurrence}`;
  });
}

function moteEntries(motes: readonly BackdropMote[]): { mote: BackdropMote; key: string }[] {
  return motes.map((mote, index) => ({ mote, key: moteKeys(motes)[index] }));
}

/** `useNativeDriver` is unsupported on react-native-web — same reason as `AnimatedIcon`. */
const NATIVE_DRIVER = Platform.OS !== "web";

/**
 * What a motion looks like when it is not running.
 *
 * Only `flash` needs one, and it needs it badly. A flash spends nearly all of its loop dim
 * and is bright for about a tenth of a second; parked at full opacity — which is what the
 * still state would otherwise be — it is not lightning, it is a large beige rectangle
 * sitting behind the WBGT reading. That was the first thing wrong with this on device.
 *
 * Everything else rests at its authored opacity, because a still cloud is a cloud.
 */
const RESTING_FADE: Partial<Record<string, number>> = { flash: 0.15 };

const WeatherBackdrop: FC<WeatherBackdropProps> = ({ condition, night, radius }) => {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();

  /*
   * Stops the loops when the worker is on another tab. A full-card animation running behind
   * a screen nobody is looking at is battery spent on an outdoor shift for nothing — the
   * same argument that keeps the weather poll focus-gated.
   */
  const focused = useIsFocused();

  // Measured rather than assumed: the card grows by more than half at 1.5x font scale, and
  // percentage geometry is meaningless until there is something to take a percentage of.
  const [size, setSize] = useState({ width: 0, height: 0 });

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
  };

  const spec = backdropFor(condition, night);

  // High contrast exists so the card is legible in direct sun. Illustration behind a
  // display-size WBGT reading defeats exactly that, so there is no backdrop at all — not a
  // fainter one. See the plan: any wash that survived a contrast check against every text
  // colour would be so scrimmed it is no longer a backdrop.
  if (theme.highContrast || !spec) {
    return null;
  }

  return (
    <View
      style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: "hidden" }]}
      onLayout={onLayout}
      // Never intercepts the pull-to-refresh gesture, or a tap meant for the card.
      pointerEvents="none"
      // Decorative in the strict sense: it repeats nothing and adds nothing, so a screen
      // reader must not find it at all.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: spec.tint, opacity: spec.tintOpacity },
        ]}
      />

      {size.width > 0
        ? moteEntries(spec.motes).map(({ mote, key }) => (
            <Mote
              key={key}
              mote={mote}
              cardWidth={size.width}
              cardHeight={size.height}
              animate={!reduceMotion && focused}
            />
          ))
        : null}
    </View>
  );
};

interface MoteProps {
  mote: BackdropMote;
  cardWidth: number;
  cardHeight: number;
  animate: boolean;
}

const Mote: FC<MoteProps> = ({ mote, cardWidth, cardHeight, animate }) => {
  const width = (mote.size / 100) * cardWidth;
  const height = width * (mote.aspect ?? 1);

  // Separate channels so two motions can never fight over one value — the same arrangement
  // as `AnimatedIcon`, and for the same reason.
  const shiftX = useRef(new Animated.Value(0)).current;
  const shiftY = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const fade = useRef(new Animated.Value(1)).current;

  const { motion, duration = 4000, delay = 0 } = mote;

  useEffect(() => {
    /*
     * Reset first, every time. These values are refs and outlive the loop driving them, so
     * switching conditions mid-animation would otherwise leave a drop frozen part-way down
     * the card. Reachable in ordinary use: the condition changes on every refresh, and the
     * dev scenario switcher changes it on a tap.
     */
    shiftX.setValue(0);
    shiftY.setValue(0);
    scale.setValue(1);
    fade.setValue(RESTING_FADE[motion] ?? 1);

    if (!animate || motion === "none") return;

    const to = (value: Animated.Value, target: number, ms: number, easing = Easing.inOut(Easing.ease)) =>
      Animated.timing(value, {
        toValue: target,
        duration: ms,
        easing,
        useNativeDriver: NATIVE_DRIVER,
      });

    let animation: Animated.CompositeAnimation;

    switch (motion) {
      case "fall":
        // Linear and one-directional, restarting at the top. Rain does not ease.
        animation = Animated.loop(
          Animated.sequence([
            to(shiftY, cardHeight, duration, Easing.linear),
            // Reset above the card, invisibly, rather than tweening back up.
            to(shiftY, -height, 0, Easing.linear),
          ]),
        );
        break;

      case "drift":
        animation = Animated.loop(
          Animated.sequence([
            to(shiftX, cardWidth * 0.08, duration),
            to(shiftX, cardWidth * -0.08, duration),
          ]),
        );
        break;

      case "sway":
        animation = Animated.loop(
          Animated.sequence([
            to(shiftX, cardWidth * 0.05, duration),
            to(shiftX, cardWidth * -0.05, duration),
          ]),
        );
        break;

      case "pulse":
        animation = Animated.loop(
          Animated.sequence([
            Animated.parallel([to(scale, 1.12, duration), to(fade, 0.7, duration)]),
            Animated.parallel([to(scale, 1, duration), to(fade, 1, duration)]),
          ]),
        );
        break;

      case "flash":
        // Held dim, then two quick blinks. An even pulse reads as "loading"; a storm
        // flashes in bursts. Same shape as `AnimatedIcon`'s flash, one layer back.
        animation = Animated.loop(
          Animated.sequence([
            Animated.delay(duration),
            to(fade, 1, 80, Easing.linear),
            to(fade, 0.15, 120, Easing.linear),
            to(fade, 0.85, 70, Easing.linear),
            to(fade, 0.15, 200, Easing.linear),
          ]),
        );
        break;
    }

    const timer = setTimeout(() => animation.start(), delay);

    return () => {
      clearTimeout(timer);
      animation.stop();
    };
  }, [animate, motion, duration, delay, cardWidth, cardHeight, height, shiftX, shiftY, scale, fade]);

  return (
    <Animated.View
      style={{
        position: "absolute",
        // Positioned from its own centre, so a mote's coordinates mean where it *is*
        // rather than where its top-left corner is.
        left: (mote.x / 100) * cardWidth - width / 2,
        top: (mote.y / 100) * cardHeight - height / 2,
        width,
        height,
        borderRadius: Math.min(width, height) * (mote.rounding ?? 0.5),
        backgroundColor: mote.color,
        opacity: Animated.multiply(fade, mote.opacity),
        transform: [{ translateX: shiftX }, { translateY: shiftY }, { scale }],
      }}
    />
  );
};

export default WeatherBackdrop;
