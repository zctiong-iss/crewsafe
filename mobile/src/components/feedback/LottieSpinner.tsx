/**
 * The animated part of {@link AppLoader}, on native.
 *
 * Split into its own module — with a `.web.tsx` sibling Metro picks automatically — because
 * `lottie-react-native` imports `@lottiefiles/dotlottie-react` at module scope in its web
 * entry point. A runtime `Platform.OS === "web"` check cannot help with that: the import is
 * resolved when the bundle is built, so the web build fails before any of our code runs.
 * Platform-specific files are the only thing that keeps the dependency off the web graph.
 *
 * @author Justin Chua
 */
import LottieView from "lottie-react-native";
import type { FC } from "react";

export interface LottieSpinnerProps {
  /** Already device-scaled. */
  size: number;
  color: string;
}

const LottieSpinner: FC<LottieSpinnerProps> = ({ size, color }) => (
  <LottieView
    source={require("@/assets/animations/loading.json")}
    autoPlay
    loop
    style={{ width: size, height: size }}
    // Recolours the arc so one asset works on a dark surface as well as a light one. The
    // keypath must match a shape name inside the JSON — "stroke" is the name used in the
    // bundled loading.json. An unmatched keypath is silently ignored rather than raising,
    // so if you swap in an animation from lottiefiles.com, check that it still tints;
    // otherwise it renders in whatever colour it was authored with.
    colorFilters={[{ keypath: "stroke", color }]}
  />
);

export default LottieSpinner;
