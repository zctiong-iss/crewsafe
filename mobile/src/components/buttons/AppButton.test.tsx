/**
 * AppButton — the press-to-fill destructive affordance (ADR-0017 §5).
 *
 * ── WHAT IS ACTUALLY AT RISK HERE ───────────────────────────────────────────────────────
 * The `danger` variant now changes appearance under the thumb. Two ways that can go wrong,
 * and both are worse than the plain steady fill it replaces:
 *
 *   1. A DISABLED danger button that still fills on press. It looks like it fired. A
 *      supervisor who taps "Cancel Shift" while the request is already in flight, sees it
 *      turn red, and walks away has been told something false.
 *   2. A button left filled after the thumb drags off it — the same lie, held.
 *
 * `primary` and `secondary` must be untouched by any of this; their press cue is still
 * `activeOpacity`, and a regression there would be silent.
 */
import { fireEvent, render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { buildTheme } from "@/styles/theme";

const mockTheme = buildTheme(false, 1);

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => mockTheme,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import AppButton from "./AppButton";

type Rendered = Awaited<ReturnType<typeof render>>;

/** The flattened style of the touchable itself — the node carrying the fill and border. */
function buttonStyle(tree: Rendered): Record<string, unknown> {
  return (StyleSheet.flatten(tree.getByRole("button").props.style) ?? {}) as Record<
    string,
    unknown
  >;
}

it("leaves a danger button outlined at rest", async () => {
  const tree = await render(<AppButton title="Cancel Shift" variant="danger" onPress={jest.fn()} />);
  const style = buttonStyle(tree);

  expect(style.backgroundColor).toBe(mockTheme.colors.surface);
  expect(style.borderColor).toBe(mockTheme.colors.danger);
});

it("fills a danger button while it is pressed", async () => {
  const tree = await render(<AppButton title="Cancel Shift" variant="danger" onPress={jest.fn()} />);

  await fireEvent(tree.getByRole("button"), "pressIn");

  expect(buttonStyle(tree).backgroundColor).toBe(mockTheme.colors.danger);
});

it("returns a danger button to outlined when the thumb leaves it", async () => {
  // A button left filled after the press ends reads as though the action fired.
  const tree = await render(<AppButton title="Cancel Shift" variant="danger" onPress={jest.fn()} />);

  await fireEvent(tree.getByRole("button"), "pressIn");
  await fireEvent(tree.getByRole("button"), "pressOut");

  expect(buttonStyle(tree).backgroundColor).toBe(mockTheme.colors.surface);
});

it("never fills a DISABLED danger button, however hard it is pressed", async () => {
  // The regression that matters most: `isInactive` must win over `pressed`. A disabled
  // destructive button that turns red on touch tells the user it did something.
  const tree = await render(
    <AppButton title="Cancel Shift" variant="danger" disabled onPress={jest.fn()} />,
  );

  await fireEvent(tree.getByRole("button"), "pressIn");

  const style = buttonStyle(tree);
  expect(style.backgroundColor).toBe(mockTheme.colors.disabled);
  expect(style.backgroundColor).not.toBe(mockTheme.colors.danger);
});

it("never fills a LOADING danger button", async () => {
  // Same failure, reached the other way: a decision already in flight.
  const tree = await render(
    <AppButton title="Cancel Shift" variant="danger" loading onPress={jest.fn()} />,
  );

  await fireEvent(tree.getByRole("button"), "pressIn");

  expect(buttonStyle(tree).backgroundColor).toBe(mockTheme.colors.disabled);
});

it("keeps a primary button filled at rest and under press", async () => {
  const tree = await render(<AppButton title="Approve" variant="primary" onPress={jest.fn()} />);
  expect(buttonStyle(tree).backgroundColor).toBe(mockTheme.colors.primary);

  await fireEvent(tree.getByRole("button"), "pressIn");
  expect(buttonStyle(tree).backgroundColor).toBe(mockTheme.colors.primary);
});

it("leaves a secondary button's surface unchanged under press", async () => {
  const tree = await render(<AppButton title="Edit" variant="secondary" onPress={jest.fn()} />);
  expect(buttonStyle(tree).backgroundColor).toBe(mockTheme.colors.surface);

  await fireEvent(tree.getByRole("button"), "pressIn");
  const style = buttonStyle(tree);
  expect(style.backgroundColor).toBe(mockTheme.colors.surface);
  expect(style.borderColor).toBe(mockTheme.colors.borderStrong);
});

it("still fires onPress for an enabled danger button", async () => {
  const onPress = jest.fn();
  const tree = await render(
    <AppButton title="Cancel Shift" variant="danger" onPress={onPress} />,
  );

  await fireEvent.press(tree.getByRole("button"));

  expect(onPress).toHaveBeenCalledTimes(1);
});

it("does not fire onPress for a disabled danger button", async () => {
  const onPress = jest.fn();
  const tree = await render(
    <AppButton title="Cancel Shift" variant="danger" disabled onPress={onPress} />,
  );

  await fireEvent.press(tree.getByRole("button"));

  expect(onPress).not.toHaveBeenCalled();
});
