/**
 * RaiseConcernSheet (SCRUM-352 / FR-005, US-11).
 *
 * Chips carry the meaning that survives translation; the note is optional so a worker can
 * never be blocked from reporting because they cannot write in a language their supervisor
 * reads (see the file's own header comment). Asserts the empty-submission negative case,
 * chip toggling, and that a note alone is enough without any chip selected.
 */
import { fireEvent, render } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => jest.requireActual("@/styles/theme").defaultTheme,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
// The empty-submission error renders through MessageBanner -> AnimatedIcon, which reads the
// reduce-motion preference out of the store.
jest.mock("@/hooks/useReduceMotion", () => ({
  useReduceMotion: () => false,
  useSystemReduceMotion: () => false,
}));

import RaiseConcernSheet from "./RaiseConcernSheet";

it("blocks submission with an error when nothing is selected and no note is written", async () => {
  const onSend = jest.fn();
  const { getByText } = await render(
    <RaiseConcernSheet visible saving={false} onCancel={jest.fn()} onSend={onSend} />,
  );

  await fireEvent.press(getByText("wellbeing.concernSend"));

  expect(onSend).not.toHaveBeenCalled();
  expect(getByText("wellbeing.concernEmpty")).not.toBeNull();
});

it("submits the selected symptoms with no note required", async () => {
  const onSend = jest.fn();
  const { getByText } = await render(
    <RaiseConcernSheet visible saving={false} onCancel={jest.fn()} onSend={onSend} />,
  );

  await fireEvent.press(getByText("symptoms.DIZZINESS"));
  await fireEvent.press(getByText("wellbeing.concernSend"));

  expect(onSend).toHaveBeenCalledWith({ symptoms: ["DIZZINESS"], note: undefined });
});

it("toggles a symptom off on a second tap", async () => {
  const onSend = jest.fn();
  const { getByText } = await render(
    <RaiseConcernSheet visible saving={false} onCancel={jest.fn()} onSend={onSend} />,
  );

  await fireEvent.press(getByText("symptoms.NAUSEA"));
  await fireEvent.press(getByText("symptoms.NAUSEA"));
  await fireEvent.press(getByText("wellbeing.concernSend"));

  expect(getByText("wellbeing.concernEmpty")).not.toBeNull();
  expect(onSend).not.toHaveBeenCalled();
});

it("accepts a note alone with no symptom chip selected", async () => {
  const onSend = jest.fn();
  const { getByLabelText, getByText } = await render(
    <RaiseConcernSheet visible saving={false} onCancel={jest.fn()} onSend={onSend} />,
  );

  await fireEvent.changeText(getByLabelText("wellbeing.noteLabel"), "Feeling dizzy and hot");
  await fireEvent.press(getByText("wellbeing.concernSend"));

  expect(onSend).toHaveBeenCalledWith({ symptoms: [], note: "Feeling dizzy and hot" });
});

it("calls onCancel without submitting anything", async () => {
  const onCancel = jest.fn();
  const onSend = jest.fn();
  const { getByText } = await render(
    <RaiseConcernSheet visible saving={false} onCancel={onCancel} onSend={onSend} />,
  );

  await fireEvent.press(getByText("common.cancel"));

  expect(onCancel).toHaveBeenCalled();
  expect(onSend).not.toHaveBeenCalled();
});

it("shows a sending state while saving", async () => {
  const { getByText } = await render(
    <RaiseConcernSheet visible saving onCancel={jest.fn()} onSend={jest.fn()} />,
  );
  expect(getByText("wellbeing.concernSending")).not.toBeNull();
});
