/**
 * The status affordance and what it explains.
 *
 * The load-bearing case is the negative one. An info button that is always present looks fine
 * in review and quietly trains people that pressing it is not worth the effort — and then they
 * do not press it on the day the reading is stale. A test is the only thing that notices that
 * regression, because nothing about it looks wrong on screen.
 *
 * @author Justin Chua
 */
import { fireEvent, render } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => jest.requireActual("@/styles/theme").defaultTheme,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${Object.values(vars).join(",")}` : key,
    i18n: { language: "en" },
  }),
}));

import WeatherStatusButton from "./WeatherStatusButton";
import WeatherStatusModal, { type WeatherStatusSubject } from "./WeatherStatusModal";
import type { WeatherQualityStatus } from "@/types/domain";

describe("the button", () => {
  it.each(["DELAYED", "STALE", "SIMULATED", "NO_READING", "LOAD_ERROR"] as const)(
    "is offered for %s",
    async (subject) => {
      const { queryByLabelText } = await render(
        <WeatherStatusButton subject={subject} onPress={jest.fn()} />,
      );

      expect(queryByLabelText("weather.statusButtonLabel")).not.toBeNull();
    },
  );

  it("is NOT offered on a live reading", async () => {
    /*
     * Silence is the correct output for a healthy reading — the same rule `FreshnessNotice`
     * applies to its own LIVE case. A dialog saying "everything is fine" is not information,
     * it is a lesson that the button can be ignored.
     */
    const { queryByLabelText } = await render(
      <WeatherStatusButton subject="LIVE" onPress={jest.fn()} />,
    );

    expect(queryByLabelText("weather.statusButtonLabel")).toBeNull();
  });

  it("says what tapping does, for someone who cannot see the icon", async () => {
    const { getByLabelText } = await render(
      <WeatherStatusButton subject="DELAYED" onPress={jest.fn()} />,
    );

    const button = getByLabelText("weather.statusButtonLabel");
    expect(button.props.accessibilityRole).toBe("button");
    expect(button.props.accessibilityHint).toBe("weather.statusButtonHint");
  });

  it("opens the explanation when pressed", async () => {
    const onPress = jest.fn();
    const { getByLabelText } = await render(
      <WeatherStatusButton subject="STALE" onPress={onPress} />,
    );

    await fireEvent.press(getByLabelText("weather.statusButtonLabel"));

    expect(onPress).toHaveBeenCalled();
  });
});

describe("the modal", () => {
  it.each([
    ["STALE", "freshness.staleWarning"],
    ["DELAYED", "freshness.delayedWarning"],
    ["SIMULATED", "freshness.simulatedNotice"],
    ["NO_READING", "weather.noReadingBody"],
    ["LOAD_ERROR", "weather.statusErrorBody"],
  ] as const)("explains %s", async (subject, expectedBody) => {
    const { getByText } = await render(
      <WeatherStatusModal
        visible
        subject={subject}
        observedAt={null}
        onDismiss={jest.fn()}
      />,
    );

    expect(getByText(expectedBody)).toBeTruthy();
  });

  it("reuses the existing freshness copy rather than a second translation of it", async () => {
    /*
     * Those strings were translated once into seven languages. A parallel set saying almost
     * the same thing would drift, and which version a worker saw would then depend on whether
     * they tapped the icon or read the banner.
     */
    const { getByText } = await render(
      <WeatherStatusModal visible subject="STALE" observedAt={null} onDismiss={jest.fn()} />,
    );

    expect(getByText("freshness.STALE")).toBeTruthy();
    expect(getByText("freshness.staleWarning")).toBeTruthy();
  });

  it("says when the reading was taken", async () => {
    // "Delayed" alone leaves a worker unable to judge whether it is five minutes old or fifty,
    // which is the difference between usable and not.
    const { getByText } = await render(
      <WeatherStatusModal visible subject="DELAYED" observedAt="11:46" onDismiss={jest.fn()} />,
    );

    expect(getByText("weather.statusObservedAt:11:46")).toBeTruthy();
  });

  it("omits the timestamp when there is no reading to have taken", async () => {
    const { queryByText } = await render(
      <WeatherStatusModal visible subject="NO_READING" observedAt={null} onDismiss={jest.fn()} />,
    );

    expect(queryByText(/statusObservedAt/)).toBeNull();
  });

  it("degrades to a neutral explanation on a status this build predates", async () => {
    // The server owns this enum. An unrecognised value should read as "unconfirmed, follow
    // procedure" — throwing would take the weather screen down over an unknown label.
    const { getByText } = await render(
      <WeatherStatusModal
        visible
        subject={"SOMETHING_NEW" as WeatherQualityStatus as WeatherStatusSubject}
        observedAt={null}
        onDismiss={jest.fn()}
      />,
    );

    expect(getByText("weather.statusUnknownBody")).toBeTruthy();
  });

  it("can be dismissed by the Android back gesture as well as the button", async () => {
    const onDismiss = jest.fn();
    const { getByText } = await render(
      <WeatherStatusModal visible subject="DELAYED" observedAt={null} onDismiss={onDismiss} />,
    );

    /*
     * Without `onRequestClose` the modal is a trap on the platform where back is the primary
     * way out of anything. Found by walking up from the close button rather than by querying
     * for the Modal type: the host Modal is not the component this file renders, so there is
     * no stable type to ask for.
     */
    let node = getByText("common.close").parent;
    while (node && node.props?.onRequestClose === undefined) node = node.parent;
    expect(node?.props.onRequestClose).toBe(onDismiss);

    await fireEvent.press(getByText("common.close"));
    expect(onDismiss).toHaveBeenCalled();
  });
});
