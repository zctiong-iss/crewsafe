/**
 * An Ionicon with motion appropriate to what it is saying.
 *
 * ── WHY NOT LOTTIE ──────────────────────────────────────────────────────────────────────
 * Lottie is the right tool for designed vector animation — a character, a staged reveal,
 * anything an illustrator authored. It is the wrong tool for pulsing or rotating a glyph,
 * and using it here would cost a hand-authored JSON per state that nobody can visually
 * verify in review, a platform split so the web bundle still builds (see
 * `LottieSpinner.web.tsx`), and a redraw of every icon as vector paths that will not match
 * the Ionicons the rest of the app uses.
 *
 * Driving the real Ionicon with React Native's `Animated` means the glyph is guaranteed to
 * render, each motion is a few lines, it behaves identically on web and native, and
 * `transform`/`opacity` both run on the native driver.
 *
 * For weather specifically, `WeatherIcon` documents how to swap in a designed LottieFiles
 * set later — the decision is not closed by this file.
 *
 * ── MOTION IS NOT DECORATION ────────────────────────────────────────────────────────────
 * Each motion says something: an urgent pulse and a calm breathe are not interchangeable,
 * because a worker learns to read the tempo before they read the words. `pop` deliberately
 * does not loop — a completed thing has no reason to keep asking for attention.
 *
 * All of it stops when `useReduceMotion` is true.
 */
import { useEffect, useRef } from "react";
import { Animated, Easing, Platform } from "react-native";
import type { FC } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useReduceMotion } from "@/hooks/useReduceMotion";

export type IconMotion =
  /** Fast, insistent scale pulse. Stop-work and failures. */
  | "urgent"
  /** Slower scale pulse. Advisory — "pay attention", not "act now". */
  | "steady"
  /** Opacity only, slow. Informational; nothing is wrong. */
  | "breathe"
  /** One scale pop on mount, then still. Completion. */
  | "pop"
  /** Continuous slow rotation. The sun. */
  | "rotate"
  /** Side to side. Wind. */
  | "sway"
  /** Up and down. Falling rain. */
  | "bob"
  /** Sharp opacity blink with a pause between. Lightning in a storm. */
  | "flash"
  /** Wide, slow horizontal travel. Cloud cover. */
  | "drift"
  | "none";

interface AnimatedIconProps {
  name: keyof typeof Ionicons.glyphMap;
  size: number;
  color: string;
  motion?: IconMotion;
  style?: object;
}

/*
 * `useNativeDriver` is unsupported on react-native-web and logs a warning per animation.
 * Transform and opacity are both driver-eligible everywhere else.
 */
const NATIVE_DRIVER = Platform.OS !== "web";

const AnimatedIcon: FC<AnimatedIconProps> = ({ name, size, color, motion = "none", style }) => {
  const reduceMotion = useReduceMotion();

  // Separate values so motions never fight over one channel. `spin` is 0..1 and is
  // interpolated to degrees — Animated cannot tween a string.
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const shiftX = useRef(new Animated.Value(0)).current;
  const shiftY = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    /*
     * Reset every value before anything else, on every change.
     *
     * The values outlive the animation that was driving them — they are refs. Switching
     * from a scale motion to an opacity one while mid-pulse used to leave `scale` frozen
     * wherever the interrupted loop had reached, so the icon breathed at a permanent 1.13.
     * Reachable in normal use: the lightning banner goes urgent → steady → none as the
     * scenario changes or the validity window lapses, and the weather icon changes motion
     * whenever the condition does.
     */
    scale.setValue(1);
    opacity.setValue(1);
    shiftX.setValue(0);
    shiftY.setValue(0);
    spin.setValue(0);

    if (reduceMotion || motion === "none") return;

    const step = (value: Animated.Value, to: number, duration: number, easing = Easing.inOut(Easing.ease)) =>
      Animated.timing(value, {
        toValue: to,
        duration,
        easing,
        useNativeDriver: NATIVE_DRIVER,
      });

    const pingPong = (value: Animated.Value, to: number, duration: number) =>
      Animated.loop(Animated.sequence([step(value, to, duration), step(value, -to, duration)]));

    let animation: Animated.CompositeAnimation;

    switch (motion) {
      case "urgent":
        animation = Animated.loop(Animated.sequence([step(scale, 1.18, 420), step(scale, 1, 420)]));
        break;

      case "steady":
        animation = Animated.loop(Animated.sequence([step(scale, 1.1, 800), step(scale, 1, 800)]));
        break;

      case "breathe":
        animation = Animated.loop(
          Animated.sequence([step(opacity, 0.55, 1200), step(opacity, 1, 1200)]),
        );
        break;

      case "pop":
        scale.setValue(0.6);
        animation = Animated.sequence([step(scale, 1.15, 260), step(scale, 1, 160)]);
        break;

      case "rotate":
        // Linear, or the sun visibly hesitates once per revolution.
        animation = Animated.loop(step(spin, 1, 14_000, Easing.linear));
        break;

      case "sway":
        animation = pingPong(shiftX, 3, 900);
        break;

      case "bob":
        animation = pingPong(shiftY, 2.5, 700);
        break;

      case "flash":
        // Held bright, then two quick blinks — a storm flashes in bursts, it does not
        // pulse evenly, and an even pulse reads as "loading".
        animation = Animated.loop(
          Animated.sequence([
            Animated.delay(1400),
            step(opacity, 0.25, 90, Easing.linear),
            step(opacity, 1, 90, Easing.linear),
            step(opacity, 0.35, 70, Easing.linear),
            step(opacity, 1, 130, Easing.linear),
          ]),
        );
        break;

      case "drift":
        animation = pingPong(shiftX, 6, 2600);
        break;
    }

    animation.start();

    // Stopping on unmount matters more than usual: a looping animation left running holds a
    // reference to the component and keeps the JS thread waking up on a screen nobody is
    // looking at.
    return () => {
      animation.stop();
    };
  }, [motion, reduceMotion, scale, opacity, shiftX, shiftY, spin]);

  // No Animated.View at all when motion is off — one less node, and nothing that could
  // animate by accident.
  if (reduceMotion || motion === "none") {
    return <Ionicons name={name} size={size} color={color} style={style} />;
  }

  return (
    <Animated.View
      style={[
        style,
        {
          opacity,
          transform: [
            { scale },
            { translateX: shiftX },
            { translateY: shiftY },
            {
              rotate: spin.interpolate({
                inputRange: [0, 1],
                outputRange: ["0deg", "360deg"],
              }),
            },
          ],
        },
      ]}
    >
      <Ionicons name={name} size={size} color={color} />
    </Animated.View>
  );
};

export default AnimatedIcon;
