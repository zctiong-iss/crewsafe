/**
 * The in-app date / date-time picker.
 *
 * This file exists partly *because* of the change it covers. The picker it replaced was
 * `DateTimePickerAndroid.open` — an imperative call into a native module — so none of this
 * behaviour could be exercised in Jest at all. The draft-then-confirm semantics, the month
 * arithmetic and the time stepping were previously only verifiable by hand on a device.
 *
 * @author Justin Chua
 */
import { fireEvent, render, screen } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => jest.requireActual("@/styles/theme").defaultTheme,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("@/hooks/useReduceMotion", () => ({ useReduceMotion: () => false }));

import AppCalendarPicker from "./AppCalendarPicker";

/** Wednesday 26 August 2026, 10:15 local — the date in the screenshot that prompted this. */
const INITIAL = new Date(2026, 7, 26, 10, 15);

/** `render` is awaited throughout this repo — @testing-library/react-native 14 returns a promise. */
async function renderPicker(
  overrides: Partial<React.ComponentProps<typeof AppCalendarPicker>> = {},
) {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  await render(
    <AppCalendarPicker
      visible
      onCancel={onCancel}
      onConfirm={onConfirm}
      initialValue={INITIAL}
      mode="datetime"
      locale="en-SG"
      title="Starts"
      {...overrides}
    />,
  );
  return { onConfirm, onCancel };
}

describe("rendering", () => {
  it("opens on the month of the initial value", async () => {
    await renderPicker();
    expect(screen.getByText("August 2026")).toBeTruthy();
  });

  it("marks the initial day as selected for a screen reader", async () => {
    await renderPicker();
    const day = screen.getByLabelText("Wednesday, 26 August 2026");
    expect(day.props.accessibilityState.selected).toBe(true);
  });

  /* A bare "26" in a grid is meaningless read aloud; the full date is what gets announced. */
  it("gives every day a spoken full date rather than a bare number", async () => {
    await renderPicker();
    expect(screen.getByLabelText("Saturday, 1 August 2026")).toBeTruthy();
    expect(screen.getByLabelText("Monday, 31 August 2026")).toBeTruthy();
  });

  it("omits the time row in date-only mode", async () => {
    await renderPicker({ mode: "date" });
    expect(screen.queryByText("datePicker.time")).toBeNull();
  });

  it("shows the time row in datetime mode", async () => {
    await renderPicker();
    expect(screen.getByText("datePicker.time")).toBeTruthy();
    // By testID, not text: "10" and "15" are also day numbers in the grid above.
    expect(screen.getByTestId("datePicker-hour")).toHaveTextContent("10");
    expect(screen.getByTestId("datePicker-minute")).toHaveTextContent("15");
  });
});

describe("draft semantics", () => {
  /*
   * The behaviour that matters most. Someone browsing months to find a date has not chosen
   * anything yet — a picker that wrote every tap through would edit the form underneath them.
   */
  it("does not commit anything until Confirm", async () => {
    const { onConfirm } = await renderPicker();

    await fireEvent.press(screen.getByLabelText("Monday, 10 August 2026"));

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("commits the chosen day on Confirm", async () => {
    const { onConfirm } = await renderPicker();

    await fireEvent.press(screen.getByLabelText("Monday, 10 August 2026"));
    await fireEvent.press(screen.getByText("common.confirm"));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const picked = onConfirm.mock.calls[0][0] as Date;
    expect(picked.getFullYear()).toBe(2026);
    expect(picked.getMonth()).toBe(7);
    expect(picked.getDate()).toBe(10);
  });

  it("keeps the time when a different day is chosen", async () => {
    const { onConfirm } = await renderPicker();

    await fireEvent.press(screen.getByLabelText("Monday, 10 August 2026"));
    await fireEvent.press(screen.getByText("common.confirm"));

    const picked = onConfirm.mock.calls[0][0] as Date;
    expect(picked.getHours()).toBe(10);
    expect(picked.getMinutes()).toBe(15);
  });

  it("cancels without committing", async () => {
    const { onConfirm, onCancel } = await renderPicker();

    await fireEvent.press(screen.getByLabelText("Monday, 10 August 2026"));
    await fireEvent.press(screen.getByText("common.cancel"));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("month navigation", () => {
  it("moves back a month", async () => {
    await renderPicker();
    await fireEvent.press(screen.getByLabelText("datePicker.previousMonth"));
    expect(screen.getByText("July 2026")).toBeTruthy();
  });

  it("moves forward a month", async () => {
    await renderPicker();
    await fireEvent.press(screen.getByLabelText("datePicker.nextMonth"));
    expect(screen.getByText("September 2026")).toBeTruthy();
  });

  it("crosses a year boundary", async () => {
    await renderPicker({ initialValue: new Date(2026, 11, 15, 9, 0) });
    await fireEvent.press(screen.getByLabelText("datePicker.nextMonth"));
    expect(screen.getByText("January 2027")).toBeTruthy();
  });

  /*
   * The classic month-arithmetic bug: from the 31st, +1 month lands two months on, because
   * the shorter month has no 31st to land on. Navigation anchors to day 1 to avoid it.
   */
  it("does not skip a month when navigating from the 31st", async () => {
    await renderPicker({ initialValue: new Date(2026, 6, 31, 9, 0) });
    await fireEvent.press(screen.getByLabelText("datePicker.nextMonth"));
    expect(screen.getByText("August 2026")).toBeTruthy();
  });
});

describe("time stepping", () => {
  it("steps minutes by five", async () => {
    const { onConfirm } = await renderPicker();

    await fireEvent.press(screen.getByLabelText("datePicker.minuteUp"));
    await fireEvent.press(screen.getByText("common.confirm"));

    expect((onConfirm.mock.calls[0][0] as Date).getMinutes()).toBe(20);
  });

  it("steps hours by one", async () => {
    const { onConfirm } = await renderPicker();

    await fireEvent.press(screen.getByLabelText("datePicker.hourDown"));
    await fireEvent.press(screen.getByText("common.confirm"));

    expect((onConfirm.mock.calls[0][0] as Date).getHours()).toBe(9);
  });

  /*
   * Stepping past midnight must roll the date. Using setHours instead of date arithmetic
   * would wrap to the same day's other end, silently moving a shift by 24 hours.
   */
  it("rolls the date backwards when stepping before midnight", async () => {
    const { onConfirm } = await renderPicker({ initialValue: new Date(2026, 7, 26, 0, 0) });

    await fireEvent.press(screen.getByLabelText("datePicker.hourDown"));
    await fireEvent.press(screen.getByText("common.confirm"));

    const picked = onConfirm.mock.calls[0][0] as Date;
    expect(picked.getDate()).toBe(25);
    expect(picked.getHours()).toBe(23);
  });

  it("rolls the date forwards when stepping past midnight", async () => {
    const { onConfirm } = await renderPicker({ initialValue: new Date(2026, 7, 26, 23, 30) });

    await fireEvent.press(screen.getByLabelText("datePicker.hourUp"));
    await fireEvent.press(screen.getByText("common.confirm"));

    const picked = onConfirm.mock.calls[0][0] as Date;
    expect(picked.getDate()).toBe(27);
    expect(picked.getHours()).toBe(0);
  });
});

describe("local time", () => {
  /*
   * The hazard AppDateField's header documents: a date built through UTC shifts by a day in
   * some timezones. Confirming without touching anything must return the same calendar day
   * it opened on, with no round-trip through toISOString.
   */
  it("returns the same local calendar day it opened on", async () => {
    const { onConfirm } = await renderPicker();

    await fireEvent.press(screen.getByText("common.confirm"));

    const picked = onConfirm.mock.calls[0][0] as Date;
    expect(picked.getFullYear()).toBe(INITIAL.getFullYear());
    expect(picked.getMonth()).toBe(INITIAL.getMonth());
    expect(picked.getDate()).toBe(INITIAL.getDate());
  });
});
