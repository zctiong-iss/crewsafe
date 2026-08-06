/**
 * Spacing and surface helpers shared across screens, so padding is agreed in one place.
 *
 * @author Justin Chua
 */
import { s, vs } from "react-native-size-matters";

export const sharedPaddingHorizontal = s(16);
export const sharedGap = vs(12);

/**
 * Elevation is a shadow, and a shadow is a low-contrast cue — it is the first thing to
 * disappear in direct sun. Components take a `highContrast` flag and swap the shadow for a
 * real border rather than stacking both, so a card is never outlined *and* floating.
 */
export function cardSurface(highContrast: boolean, borderColor: string, borderWidth: number) {
  if (highContrast) {
    return { borderWidth, borderColor };
  }
  return {
    borderWidth,
    borderColor,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  };
}
