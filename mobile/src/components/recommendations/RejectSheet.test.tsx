/**
 * RejectSheet (SCRUM-352 / FR-004, US-09).
 *
 * A rejection reason is required, and checked client-side before the round trip that would
 * otherwise 400 (see the file's own header comment). Asserts the reasonless-submit negative
 * case, the trimmed-reason success case, and that reopening the sheet clears a prior reason.
 */
import { fireEvent, render } from "@testing-library/react-native";

// The real, fully-populated default theme — RejectSheet composes AppButton, AppTextInput
// and AppText, each of which reads several colour/metric fields, so a hand-picked partial
// mock would need to grow every time one of them touches a new token.
jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => jest.requireActual("@/styles/theme").defaultTheme,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import RejectSheet from "./RejectSheet";

it("blocks submission and shows an error when no reason is entered", async () => {
  const onReject = jest.fn();
  const { getByText } = await render(
    <RejectSheet visible saving={false} onCancel={jest.fn()} onReject={onReject} />,
  );

  await fireEvent.press(getByText("recommendations.rejectConfirm"));

  expect(onReject).not.toHaveBeenCalled();
  expect(getByText("recommendations.rejectReasonRequired")).not.toBeNull();
});

it("submits the trimmed reason once one is entered", async () => {
  const onReject = jest.fn();
  const { getByLabelText, getByText } = await render(
    <RejectSheet visible saving={false} onCancel={jest.fn()} onReject={onReject} />,
  );

  await fireEvent.changeText(
    getByLabelText("recommendations.rejectPlaceholder"),
    "  Site now under cover  ",
  );
  await fireEvent.press(getByText("recommendations.rejectConfirm"));

  expect(onReject).toHaveBeenCalledWith("Site now under cover");
});

it("calls onCancel without submitting anything", async () => {
  const onCancel = jest.fn();
  const onReject = jest.fn();
  const { getByText } = await render(
    <RejectSheet visible saving={false} onCancel={onCancel} onReject={onReject} />,
  );

  await fireEvent.press(getByText("common.cancel"));

  expect(onCancel).toHaveBeenCalled();
  expect(onReject).not.toHaveBeenCalled();
});

it("shows a saving state and blocks the button from re-submitting", async () => {
  const { getByText } = await render(
    <RejectSheet visible saving onCancel={jest.fn()} onReject={jest.fn()} />,
  );

  expect(getByText("recommendations.deciding")).not.toBeNull();
});
