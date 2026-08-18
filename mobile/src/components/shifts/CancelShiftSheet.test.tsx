/**
 * CancelShiftSheet (SCRUM-442).
 *
 * The reason is not a form field, it is the record of why a crew was stood down — the server
 * refuses a blank one and writes what it is given to the audit trail. So the cases pinned here
 * are: a reasonless submit never leaves the device, a reason is trimmed before it goes, and
 * reopening the sheet does not carry the previous shift's reason into the next cancellation.
 *
 * @author Justin Chua
 */
import { fireEvent, render } from "@testing-library/react-native";

// The real default theme, as in RejectSheet's test — this sheet composes the same primitives,
// each of which reads several tokens, so a partial mock would need chasing.
jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => jest.requireActual("@/styles/theme").defaultTheme,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import CancelShiftSheet from "./CancelShiftSheet";

const REASON_FIELD = "shifts.cancelReasonLabel";

it("refuses to submit without a reason, before any round trip", async () => {
  const onConfirm = jest.fn();
  const { getByText } = await render(
    <CancelShiftSheet visible saving={false} onDismiss={jest.fn()} onConfirm={onConfirm} />,
  );

  await fireEvent.press(getByText("shifts.cancelConfirm"));

  expect(onConfirm).not.toHaveBeenCalled();
  expect(getByText("shifts.cancelReasonRequired")).not.toBeNull();
});

it("treats whitespace as no reason at all", async () => {
  // `@NotBlank`, not `@NotNull`. Spaces would satisfy a length check and still leave the audit
  // trail saying nothing about why a crew went home.
  const onConfirm = jest.fn();
  const { getByLabelText, getByText } = await render(
    <CancelShiftSheet visible saving={false} onDismiss={jest.fn()} onConfirm={onConfirm} />,
  );

  await fireEvent.changeText(getByLabelText(REASON_FIELD), "    ");
  await fireEvent.press(getByText("shifts.cancelConfirm"));

  expect(onConfirm).not.toHaveBeenCalled();
});

it("submits the trimmed reason", async () => {
  const onConfirm = jest.fn();
  const { getByLabelText, getByText } = await render(
    <CancelShiftSheet visible saving={false} onDismiss={jest.fn()} onConfirm={onConfirm} />,
  );

  await fireEvent.changeText(getByLabelText(REASON_FIELD), "  Lightning risk, crew stood down  ");
  await fireEvent.press(getByText("shifts.cancelConfirm"));

  expect(onConfirm).toHaveBeenCalledWith("Lightning risk, crew stood down");
});

it("caps the reason at the length the server accepts", async () => {
  // The server's `@Size(max = 500)`. Enforced here so it never has to refuse on length, which
  // would lose everything the supervisor typed.
  const { getByLabelText } = await render(
    <CancelShiftSheet visible saving={false} onDismiss={jest.fn()} onConfirm={jest.fn()} />,
  );

  expect(getByLabelText(REASON_FIELD).props.maxLength).toBe(500);
});

it("does not carry a reason from one cancellation into the next", async () => {
  /*
   * The sheet stays mounted between openings. A second cancellation arriving pre-filled with
   * the first shift's reason would attach the wrong explanation to a permanent record.
   */
  const onConfirm = jest.fn();
  const { getByLabelText, getByText, rerender } = await render(
    <CancelShiftSheet visible saving={false} onDismiss={jest.fn()} onConfirm={onConfirm} />,
  );
  await fireEvent.changeText(getByLabelText(REASON_FIELD), "Lightning risk");

  await rerender(
    <CancelShiftSheet
      visible={false}
      saving={false}
      onDismiss={jest.fn()}
      onConfirm={onConfirm}
    />,
  );
  await rerender(
    <CancelShiftSheet visible saving={false} onDismiss={jest.fn()} onConfirm={onConfirm} />,
  );

  expect(getByLabelText(REASON_FIELD).props.value).toBe("");

  await fireEvent.press(getByText("shifts.cancelConfirm"));
  expect(onConfirm).not.toHaveBeenCalled();
});
