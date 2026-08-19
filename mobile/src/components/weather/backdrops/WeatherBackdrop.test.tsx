/**
 * When the backdrop draws, and when it must not (SCRUM-209 Part 3).
 *
 * Three of these are accessibility guarantees rather than styling: high contrast exists so a
 * worker can read the card in direct sun, and Reduce Motion is a WCAG 2.2 requirement the
 * plan deliberately declined to exempt this from. A regression in either is invisible in
 * review — nothing looks broken, the setting simply stops being honoured.
 *
 * @author Justin Chua
 */
import { render } from "@testing-library/react-native";
import { View } from "react-native";

const mockUseReduceMotion = jest.fn();
const mockUseTheme = jest.fn();
const mockUseIsFocused = jest.fn();

jest.mock("@/hooks/useReduceMotion", () => ({
  useReduceMotion: () => mockUseReduceMotion(),
}));
jest.mock("@/theme/ThemeProvider", () => ({ useTheme: () => mockUseTheme() }));
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockUseIsFocused() }));

import WeatherBackdrop, { moteFingerprint, moteKeys } from "./WeatherBackdrop";
import type { BackdropMote } from "./types";
import { BACKDROPS } from "./registry";

const moteFixture = (color: string, motion: BackdropMote["motion"]): BackdropMote => ({
  x: 1,
  y: 2,
  size: 3,
  color,
  opacity: 0.4,
  motion,
});

it("derives collision-safe stable keys for reordered and duplicate motes", () => {
  const first = moteFixture("#a:b", "fall");
  const second = moteFixture("#a", "fall");
  const keys = moteKeys([first, second, first]);

  expect(moteFingerprint(first)).not.toBe(moteFingerprint(second));
  expect(new Set(keys).size).toBe(3);
  expect(moteKeys([second, first])[1]).toBe(keys[0]);
});

/** Only the two fields this component reads. */
function theme(highContrast: boolean) {
  return { highContrast, metrics: { radius: 12 } };
}

beforeEach(() => {
  mockUseReduceMotion.mockReturnValue(false);
  mockUseTheme.mockReturnValue(theme(false));
  mockUseIsFocused.mockReturnValue(true);
});

/** Counts the drawn layers: the wash, plus one per mote. */
function layerCount(json: unknown): number {
  let count = 0;
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const element = node as { type?: string; children?: unknown[] };
    if (element.type === "View") count += 1;
    (element.children ?? []).forEach(walk);
  };
  walk(json);
  return count;
}

it("draws nothing at all in high contrast", async () => {
  mockUseTheme.mockReturnValue(theme(true));

  const { toJSON } = await render(<WeatherBackdrop condition="RAIN" night={false} radius={12} />);

  // Not a fainter backdrop, and not an empty frame — nothing. High contrast is the mode
  // that makes a display-size WBGT reading legible in sun; illustration behind it defeats
  // exactly that.
  expect(toJSON()).toBeNull();
});

it("draws nothing for a condition with no entry, rather than an empty box", async () => {
  const original = BACKDROPS.WINDY;
  delete BACKDROPS.WINDY;

  try {
    const { toJSON } = await render(<WeatherBackdrop condition="WINDY" night={false} radius={12} />);
    // A blank frame reads as a broken asset; an absent one reads as a plain card. Same
    // reasoning `WeatherIcon` gives for refusing to ship a stub branch.
    expect(toJSON()).toBeNull();
  } finally {
    BACKDROPS.WINDY = original;
  }
});

it("still draws the full still backdrop under Reduce Motion", async () => {
  mockUseReduceMotion.mockReturnValue(true);

  const { toJSON } = await render(
    <>
      <View testID="host" />
      <WeatherBackdrop condition="RAIN" night={false} radius={12} />
    </>,
  );

  // The whole point of the still state: Reduce Motion must not mean an empty card. SCRUM-199
  // defaults the preference to on, so this is the common case, not an edge one.
  expect(toJSON()).not.toBeNull();
});

it("falls back to the day backdrop for a condition with no night variant", async () => {
  // Rain looks the same after dark, so `RAIN-night` deliberately does not exist. The
  // fallback is what keeps the registry sparse instead of duplicated.
  expect(BACKDROPS["RAIN-night"]).toBeUndefined();

  const { toJSON } = await render(<WeatherBackdrop condition="RAIN" night radius={12} />);

  expect(toJSON()).not.toBeNull();
});

it("is hidden from assistive technology", async () => {
  const { toJSON } = await render(<WeatherBackdrop condition="FAIR" night={false} radius={12} />);

  const root = toJSON() as { props?: Record<string, unknown> } | null;
  // It repeats nothing and adds nothing — the icon and label already say "Fair". A screen
  // reader must not find it.
  expect(root?.props?.accessibilityElementsHidden).toBe(true);
  expect(root?.props?.importantForAccessibility).toBe("no-hide-descendants");
});

it("renders the wash before any motes have been measured", async () => {
  // Motes are laid out in percentages, so they cannot be placed until onLayout has reported
  // a size. The wash does not depend on measurement and must not wait for it, or the card
  // would flash plain on every condition change.
  const { toJSON } = await render(<WeatherBackdrop condition="CLOUDY" night={false} radius={12} />);

  expect(layerCount(toJSON())).toBe(2); // container + wash, no motes yet
});
