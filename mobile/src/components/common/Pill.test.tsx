/**
 * Pill — the three roles, and the properties that are safety-relevant (ADR-0017 §4).
 *
 * The assertions that matter here are not "does it render". They are:
 *   1. an entity chip is bordered in BOTH palettes, because in high contrast `surfaceAlt`
 *      collapses to `surface` and a fill-only chip disappears under glare;
 *   2. an entity chip ignores `tone`, so a worker's name can never render in hazard red;
 *   3. only `state` fills, because fill is reserved for the one status asking for a decision.
 *
 * `render` is awaited throughout: RNTL 14 returns a promise, and destructuring it without
 * awaiting yields a Promise rather than the queries.
 */
import { render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { buildTheme } from "@/styles/theme";

let mockTheme = buildTheme(false, 1);

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => mockTheme,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import Pill from "./Pill";

/**
 * Renders a pill and returns the flattened style of the `View` carrying the surface — the
 * nearest ancestor of the label that actually has a `borderWidth`.
 */
async function pillStyle(element: React.ReactElement) {
  const { getByText } = await render(element);
  let node = getByText("Label").parent;
  while (node) {
    const flat = StyleSheet.flatten(node.props?.style);
    if (flat && flat.borderWidth !== undefined) return flat;
    node = node.parent;
  }
  throw new Error("no bordered pill surface found");
}

beforeEach(() => {
  mockTheme = buildTheme(false, 1);
});

it("fills a state pill with the tone colour", async () => {
  const style = await pillStyle(<Pill role="state" label="Label" tone="danger" />);
  expect(style.backgroundColor).toBe(mockTheme.colors.danger);
  expect(style.borderColor).toBe(mockTheme.colors.danger);
});

it("outlines an attribute pill and leaves its fill transparent", async () => {
  // The load-bearing half of ADR-0017 §4: Required must NOT fill, or it drowns the one
  // status pill that is actually asking the supervisor for a decision.
  const style = await pillStyle(<Pill role="attribute" label="Label" tone="danger" />);
  expect(style.backgroundColor).toBe("transparent");
  expect(style.borderColor).toBe(mockTheme.colors.danger);
});

it("gives an entity chip a neutral fill and a visible border in the standard palette", async () => {
  const style = await pillStyle(<Pill role="entity" label="Label" />);
  expect(style.backgroundColor).toBe(mockTheme.colors.surfaceAlt);
  expect(style.borderColor).toBe(mockTheme.colors.border);
  expect(style.borderWidth).toBe(1);
});

it("keeps an entity chip bordered in high contrast, where surfaceAlt collapses to surface", async () => {
  // The regression this guards: high contrast makes `surfaceAlt` and `surface` both #FFFFFF,
  // so a chip relying on fill alone would vanish exactly when someone is reading under sun.
  mockTheme = buildTheme(true, 1);
  expect(mockTheme.colors.surfaceAlt).toBe(mockTheme.colors.surface);
  const style = await pillStyle(<Pill role="entity" label="Label" />);
  expect(style.borderColor).toBe("#000000");
  expect(style.borderWidth).toBe(2);
});

it("ignores tone on an entity chip, so an identity never carries a hazard colour", async () => {
  // A worker's name must not render in danger red because of who they are. Colour is
  // reserved for meaning (D3), and an identity is not a signal.
  const style = await pillStyle(<Pill role="entity" label="Label" tone="danger" />);
  expect(style.backgroundColor).toBe(mockTheme.colors.surfaceAlt);
  expect(style.borderColor).not.toBe(mockTheme.colors.danger);
});

it("fills a warning state pill with warningFill, not warning", async () => {
  /*
   * The AA trap `colors.ts` documents. `warning` (#B26A00) is 4.24:1 against white — under
   * the 4.5:1 floor — so a filled warning pill carrying white text would be illegible in the
   * sun and non-compliant. `warningFill` is the darkened value that exists for exactly this.
   */
  const style = await pillStyle(<Pill role="state" label="Label" tone="warning" />);
  expect(style.backgroundColor).toBe(mockTheme.colors.warningFill);
  expect(style.backgroundColor).not.toBe(mockTheme.colors.warning);
});

it("outlines a warning attribute pill with warning, not warningFill", async () => {
  // The other direction: as a border and as text on a light surface, plain `warning` is the
  // value that has already been checked. `warningFill` would read as brown rather than amber.
  const style = await pillStyle(<Pill role="attribute" label="Label" tone="warning" />);
  expect(style.borderColor).toBe(mockTheme.colors.warning);
});

it("defaults to the neutral tone when none is given", async () => {
  const style = await pillStyle(<Pill role="attribute" label="Label" />);
  expect(style.borderColor).toBe(mockTheme.colors.textSecondary);
});

it("derives its radius and border width from the theme metrics", async () => {
  const style = await pillStyle(<Pill role="attribute" label="Label" />);
  expect(style.borderRadius).toBe(mockTheme.metrics.radius / 2);
});

it("does not clamp its label to one line", async () => {
  // The pill this replaces carried `maxWidth: s(110)` with `numberOfLines={1}` and truncated
  // "Required" at fontScale 1.5. Pills size to content and wrap.
  const { getByText } = await render(<Pill role="attribute" label="Label" />);
  expect(getByText("Label").props.numberOfLines).toBeUndefined();
});
