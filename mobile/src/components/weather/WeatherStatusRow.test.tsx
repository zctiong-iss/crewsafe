/**
 * The row, and the regression that made it worth extracting.
 *
 * `badgeRow` on WeatherScreen was declared without `flexDirection`, so it was a column. With
 * only the freshness pill inside it that is indistinguishable from a row, and the name went
 * unchallenged — until the status button was added and appeared underneath the pill instead of
 * beside it.
 *
 * Asserting the direction looks like testing a stylesheet, and it is: this is the one property
 * whose default is silently wrong and whose name says otherwise. Everything else here is about
 * the pairing holding for every condition rather than only the one someone happened to look at.
 *
 * @author Justin Chua
 */
import { render, within } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => jest.requireActual("@/styles/theme").defaultTheme,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import WeatherStatusRow, { WEATHER_STATUS_ROW_TEST_ID } from "./WeatherStatusRow";

/**
 * The container's own resolved style.
 *
 * Addressed by test id rather than by walking up from the pill. The first version of this
 * helper did walk up, looking for the nearest ancestor with a `flexDirection` — and it passed
 * against the bug, because `Pill` has an inner row of its own and the search stopped there.
 * A test that cannot fail against the defect it names is worse than no test.
 */
function rowStyle(getByTestId: (id: string) => { props: { style?: unknown } }) {
  const { StyleSheet } = jest.requireActual("react-native");
  return (StyleSheet.flatten(getByTestId(WEATHER_STATUS_ROW_TEST_ID).props.style) ?? {}) as {
    flexDirection?: string;
    alignItems?: string;
  };
}

describe.each(["DELAYED", "STALE", "SIMULATED"] as const)("%s", (status) => {
  it("puts the explain button beside the pill, not under it", async () => {
    const { getByTestId } = await render(
      <WeatherStatusRow status={status} onExplain={jest.fn()} />,
    );

    const style = rowStyle(getByTestId);
    // The whole bug: a View with no flexDirection is a column, and the hero centres its
    // children, so the button landed on its own line below the pill.
    expect(style.flexDirection).toBe("row");
    expect(style.alignItems).toBe("center");
  });

  it("offers both the pill and the button", async () => {
    const { getByText, getByLabelText } = await render(
      <WeatherStatusRow status={status} onExplain={jest.fn()} />,
    );

    expect(getByText(`freshness.${status}`)).toBeTruthy();
    expect(getByLabelText("weather.statusButtonLabel")).toBeTruthy();
  });
});

describe("LIVE", () => {
  it("shows the pill alone, with nothing to explain", async () => {
    /*
     * Silence is the correct output for a healthy reading. A button opening a dialog that says
     * "everything is fine" teaches people it is not worth pressing, and then they do not press
     * it on the day the reading is stale.
     */
    const { getByText, queryByLabelText } = await render(
      <WeatherStatusRow status="LIVE" onExplain={jest.fn()} />,
    );

    expect(getByText("freshness.LIVE")).toBeTruthy();
    expect(queryByLabelText("weather.statusButtonLabel")).toBeNull();
  });

  it("is still laid out as a row, so adding a child later cannot restack it", async () => {
    const { getByTestId } = await render(
      <WeatherStatusRow status="LIVE" onExplain={jest.fn()} />,
    );

    expect(rowStyle(getByTestId).flexDirection).toBe("row");
  });
});

it("renders the pill before the button, so the label is read first", async () => {
  /*
   * Order is the reading order for a screen reader too: "Delayed", then "About this reading".
   * Reversed, the affordance is announced before the thing it qualifies.
   */
  const { getByTestId, getByText, getByLabelText } = await render(
    <WeatherStatusRow status="DELAYED" onExplain={jest.fn()} />,
  );

  const children = getByTestId(WEATHER_STATUS_ROW_TEST_ID).children as unknown[];
  const pill = getByText("freshness.DELAYED");
  const button = getByLabelText("weather.statusButtonLabel");

  // The pill's subtree comes first in the container's children, so it is announced first.
  expect(within(children[0] as never).queryByText("freshness.DELAYED")).not.toBeNull();
  expect(pill).not.toBe(button);
});
