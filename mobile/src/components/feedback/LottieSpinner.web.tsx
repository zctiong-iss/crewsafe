/**
 * The web stand-in for {@link LottieSpinner}. Metro resolves this over the `.tsx` sibling
 * when bundling for web.
 *
 * A plain `ActivityIndicator` rather than Lottie: web is a development target here (it is
 * where the Cognito PKCE flow can be exercised without a native build, via
 * `npm run web:pkce`), and pulling `@lottiefiles/dotlottie-react` into the tree to animate
 * a dev-only spinner is not a trade worth making. The native app — the one a worker holds —
 * gets the animation.
 *
 * @author Justin Chua
 */
import { ActivityIndicator } from "react-native";
import type { FC } from "react";
import type { LottieSpinnerProps } from "./LottieSpinner";

const LottieSpinner: FC<LottieSpinnerProps> = ({ color }) => (
  <ActivityIndicator size="large" color={color} />
);

export default LottieSpinner;
