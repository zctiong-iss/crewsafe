/**
 * Disclosure — the contract, in both modes.
 *
 * The assertions that carry weight:
 *   1. detail is NOT MOUNTED while closed. A disclosure that renders its children anyway is
 *      the always-on block with an extra button, and it also means any cost inside the detail
 *      tier is paid on every row of every list.
 *   2. the accessible name changes with state. `ExpandChevron` announces nothing, so this is
 *      the only thing telling a screen-reader user what the control does or whether it is open.
 *   3. controlled mode does not self-advance. A `FlatList` row that moved on its own would
 *      disagree with the Set its parent is holding.
 */
import { fireEvent, render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { buildTheme } from "@/styles/theme";

let mockTheme = buildTheme(false, 1);

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => mockTheme,
}));
jest.mock("@/hooks/useReduceMotion", () => ({
  useReduceMotion: () => false,
  useReduceMotionPreference: () => false,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import AppText from "@/components/texts/AppText";
import Disclosure from "./Disclosure";

const label = (open: boolean) => (open ? "Hide details" : "Details");

function subject(props: Partial<React.ComponentProps<typeof Disclosure>> = {}) {
  return (
    <Disclosure label={label} accessibilityLabel={label} {...props}>
      <AppText>the evidence</AppText>
    </Disclosure>
  );
}

beforeEach(() => {
  mockTheme = buildTheme(false, 1);
});

/* ── Uncontrolled ──────────────────────────────────────────────────────────────────────── */

it("does not mount its children while closed", async () => {
  const { queryByText } = await render(subject());
  expect(queryByText("the evidence")).toBeNull();
});

it("mounts its children once opened, and unmounts them again", async () => {
  const { queryByText, getByLabelText } = await render(subject());

  await fireEvent.press(getByLabelText("Details"));
  expect(queryByText("the evidence")).not.toBeNull();

  await fireEvent.press(getByLabelText("Hide details"));
  expect(queryByText("the evidence")).toBeNull();
});

it("honours defaultOpen", async () => {
  const { queryByText } = await render(subject({ defaultOpen: true }));
  expect(queryByText("the evidence")).not.toBeNull();
});

/* ── Accessibility ─────────────────────────────────────────────────────────────────────── */

it("reports its expanded state and renames itself when opened", async () => {
  // The chevron is silent. Without these a TalkBack user cannot tell the control exists,
  // what it does, or whether it is currently open.
  const { getByLabelText } = await render(subject());

  const closed = getByLabelText("Details");
  expect(closed.props.accessibilityRole).toBe("button");
  expect(closed.props.accessibilityState.expanded).toBe(false);

  await fireEvent.press(closed);
  expect(getByLabelText("Hide details").props.accessibilityState.expanded).toBe(true);
});

it("lets the announced name differ from the visible label", async () => {
  // ShiftListScreen's case: the visible text is a count ("3 workers") that does not change,
  // while the announced name must still say show/hide.
  const { getByLabelText, getByText } = await render(
    subject({
      label: () => "3 workers",
      accessibilityLabel: (open) => (open ? "Hide crew" : "Show crew"),
    }),
  );

  expect(getByText("3 workers")).toBeTruthy();
  expect(getByLabelText("Show crew")).toBeTruthy();
});

it("keeps the toggle a full touch target, growing it in high contrast", async () => {
  const standard = await render(subject());
  expect(
    StyleSheet.flatten(standard.getByLabelText("Details").props.style).minHeight,
  ).toBe(44);

  mockTheme = buildTheme(true, 1);
  const highContrast = await render(subject());
  // 52pt in high contrast: gloved hands, uneven ground.
  expect(
    StyleSheet.flatten(highContrast.getByLabelText("Details").props.style).minHeight,
  ).toBe(52);
});

/* ── Controlled ────────────────────────────────────────────────────────────────────────── */

it("does not change its own state when controlled", async () => {
  // A FlatList row that advanced on its own would disagree with the Set its parent holds,
  // and the disagreement would surface as a row that snaps shut on scroll.
  const onToggle = jest.fn();
  const { queryByText, getByLabelText } = await render(
    subject({ open: false, onToggle }),
  );

  await fireEvent.press(getByLabelText("Details"));

  expect(onToggle).toHaveBeenCalledWith(true);
  expect(queryByText("the evidence")).toBeNull();
});

it("renders open when the controlling parent says so", async () => {
  const { queryByText } = await render(subject({ open: true, onToggle: jest.fn() }));
  expect(queryByText("the evidence")).not.toBeNull();
});

it("ignores defaultOpen when controlled", async () => {
  const { queryByText } = await render(
    subject({ open: false, defaultOpen: true, onToggle: jest.fn() }),
  );
  expect(queryByText("the evidence")).toBeNull();
});
