/**
 * A chevron that turns to face the way a disclosure is going (SCRUM-266).
 *
 * ── WHY NOT `AnimatedIcon` ──────────────────────────────────────────────────────────────
 * Every motion that component offers is ambient: it loops forever and says "this thing is
 * ongoing". This one is the opposite — a single transition, driven by a state change, that
 * ends the moment the section is open. Adding a tenth `IconMotion` for it would have meant a
 * motion that ignores the shared loop machinery and needs a target angle passed in, which is
 * not the same kind of thing as `breathe` or `flash`.
 *
 * ── THE ROTATION IS THE LABEL ───────────────────────────────────────────────────────────
 * It replaces the words "Show crew" / "Hide crew", so the direction has to be unambiguous:
 * down means "there is more below", up means "this is already open". That is the platform
 * convention on both iOS and Android, and reversing it to look tidier would leave a
 * supervisor guessing.
 *
 * Because the words are gone, the caller **must** still give the touchable an
 * `accessibilityLabel` — a chevron announces nothing on its own. `ShiftListScreen` keeps the
 * same two locale strings for exactly that.
 *
 * ── REDUCE MOTION ───────────────────────────────────────────────────────────────────────
 * Honoured by snapping to the destination angle rather than by freezing at the old one. The
 * chevron is state, not decoration: a supervisor with Reduce Motion on still has to be able
 * to see which cards are open.
 *
 * @author Justin Chua
 */
import { useEffect, useRef, type FC } from "react";
import { Animated, Easing, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useReduceMotion } from "@/hooks/useReduceMotion";

/* Unsupported on react-native-web, where it logs a warning per animation. Rotation is
   driver-eligible everywhere else. */
const NATIVE_DRIVER = Platform.OS !== "web";

interface ExpandChevronProps {
  expanded: boolean;
  size: number;
  color: string;
}

const ExpandChevron: FC<ExpandChevronProps> = ({ expanded, size, color }) => {
  const reduceMotion = useReduceMotion();

  /*
   * Seeded from `expanded` rather than from 0, so a card that mounts already open — which is
   * what happens when the list re-renders while a crew is showing — starts pointing up instead
   * of visibly swinging into place for no reason.
   */
  const progress = useRef(new Animated.Value(expanded ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: expanded ? 1 : 0,
      // Zero rather than skipped: the value must still arrive, or the chevron would keep
      // pointing at the previous state.
      duration: reduceMotion ? 0 : 220,
      // Slight overshoot on the way round. It is the whole reason this reads as a flick
      // rather than a slider, and at 220ms it costs nothing.
      easing: Easing.bezier(0.34, 1.36, 0.64, 1),
      useNativeDriver: NATIVE_DRIVER,
    }).start();
  }, [expanded, progress, reduceMotion]);

  return (
    <Animated.View
      style={{
        transform: [
          {
            rotate: progress.interpolate({
              inputRange: [0, 1],
              outputRange: ["0deg", "180deg"],
            }),
          },
        ],
      }}
    >
      <Ionicons name="chevron-down" size={size} color={color} />
    </Animated.View>
  );
};

export default ExpandChevron;
