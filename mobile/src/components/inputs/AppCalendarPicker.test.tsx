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

import AppCalendarPicker, { calendarCellKey, WEEKDAY_KEYS, weekdayInitials } from "./AppCalendarPicker";

// The shared coverage runner executes 97 suites concurrently; allow its first native-tree render
// to absorb CPU scheduling delay without weakening any of the assertions below.
jest.setTimeout(15_000);

it("uses explicit weekday domain keys independent of rendered position", () => {
  expect(weekdayInitials("en-SG").map(({ key }) => key)).toEqual([...WEEKDAY_KEYS]);
});

it("gives blank calendar cells distinct local date identities", () => {
  expect(calendarCellKey(new Date(2026, 7, 1))).not.toBe(calendarCellKey(new Date(2026, 7, 2)));
  expect(calendarCellKey(new Date(2026, 7, 1))).toBe("blank-2026-7-1");
});

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
    // By testID and `value`, not text: these are inputs now, and "10"/"15" are also day
    // numbers in the grid above.
    expect(screen.getByTestId("datePicker-hour").props.value).toBe("10");
    expect(screen.getByTestId("datePicker-minute").props.value).toBe("15");
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

describe("typed time entry", () => {
  it("accepts a typed hour", async () => {
    const { onConfirm } = await renderPicker();

    await fireEvent.changeText(screen.getByTestId("datePicker-hour"), "7");
    await fireEvent.press(screen.getByText("common.confirm"));

    expect((onConfirm.mock.calls[0][0] as Date).getHours()).toBe(7);
  });

  it("accepts a typed minute the stepper could never reach", async () => {
    const { onConfirm } = await renderPicker();

    await fireEvent.changeText(screen.getByTestId("datePicker-minute"), "23");
    await fireEvent.press(screen.getByText("common.confirm"));

    expect((onConfirm.mock.calls[0][0] as Date).getMinutes()).toBe(23);
  });

  it("keeps the chosen day when the time is typed", async () => {
    const { onConfirm } = await renderPicker();

    await fireEvent.press(screen.getByLabelText("Monday, 10 August 2026"));
    await fireEvent.changeText(screen.getByTestId("datePicker-hour"), "6");
    await fireEvent.press(screen.getByText("common.confirm"));

    const picked = onConfirm.mock.calls[0][0] as Date;
    expect(picked.getDate()).toBe(10);
    expect(picked.getHours()).toBe(6);
  });

  it("strips non-digits rather than becoming unparseable", async () => {
    const { onConfirm } = await renderPicker();

    await fireEvent.changeText(screen.getByTestId("datePicker-minute"), "4.5");
    await fireEvent.press(screen.getByText("common.confirm"));

    expect((onConfirm.mock.calls[0][0] as Date).getMinutes()).toBe(45);
  });

  /*
   * The reason the raw text is held apart from the draft. Clearing the box to retype must be
   * possible; if the field were derived from the draft it would snap back between keystrokes.
   */
  it("allows the field to be cleared mid-entry without committing", async () => {
    const { onConfirm } = await renderPicker();

    await fireEvent.changeText(screen.getByTestId("datePicker-hour"), "");

    expect(screen.getByTestId("datePicker-hour").props.value).toBe("");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("reverts a cleared field to the draft value on blur, not to midnight", async () => {
    const { onConfirm } = await renderPicker();

    await fireEvent.changeText(screen.getByTestId("datePicker-hour"), "");
    await fireEvent(screen.getByTestId("datePicker-hour"), "blur");
    await fireEvent.press(screen.getByText("common.confirm"));

    expect((onConfirm.mock.calls[0][0] as Date).getHours()).toBe(10);
  });

  it("clamps an out-of-range hour on blur", async () => {
    const { onConfirm } = await renderPicker();

    await fireEvent.changeText(screen.getByTestId("datePicker-hour"), "99");
    await fireEvent(screen.getByTestId("datePicker-hour"), "blur");
    await fireEvent.press(screen.getByText("common.confirm"));

    expect((onConfirm.mock.calls[0][0] as Date).getHours()).toBe(23);
  });

  it("clamps an out-of-range minute on blur", async () => {
    const { onConfirm } = await renderPicker();

    await fireEvent.changeText(screen.getByTestId("datePicker-minute"), "88");
    await fireEvent(screen.getByTestId("datePicker-minute"), "blur");
    await fireEvent.press(screen.getByText("common.confirm"));

    expect((onConfirm.mock.calls[0][0] as Date).getMinutes()).toBe(59);
  });

  it("pads a single digit to two on blur", async () => {
    await renderPicker();

    await fireEvent.changeText(screen.getByTestId("datePicker-hour"), "9");
    await fireEvent(screen.getByTestId("datePicker-hour"), "blur");

    expect(screen.getByTestId("datePicker-hour").props.value).toBe("09");
  });

  /* The two controls edit one value, so neither may show something the other disagrees with. */
  it("updates the typed fields when the stepper is used", async () => {
    await renderPicker();

    await fireEvent.press(screen.getByLabelText("datePicker.minuteUp"));

    expect(screen.getByTestId("datePicker-minute").props.value).toBe("20");
  });

  it("updates the hour field when stepping rolls the hour", async () => {
    await renderPicker();

    await fireEvent.press(screen.getByLabelText("datePicker.hourUp"));

    expect(screen.getByTestId("datePicker-hour").props.value).toBe("11");
  });
});

describe("actions", () => {
  /*
   * Regression: AppButton is width:100%, so two in a flex row made the first claim the panel
   * and push the second off it. Cancel disappeared, leaving the backdrop and hardware back
   * as the only ways out.
   */
  it("renders both Cancel and Confirm", async () => {
    await renderPicker();

    expect(screen.getByText("common.cancel")).toBeTruthy();
    expect(screen.getByText("common.confirm")).toBeTruthy();
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
