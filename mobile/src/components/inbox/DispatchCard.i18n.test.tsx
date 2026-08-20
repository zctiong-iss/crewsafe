/**
 * The worker's action card, against the real translations.
 *
 * ── THE REPORTED BUG ────────────────────────────────────────────────────────────────────
 * The card's title translated and its instruction did not, so a Hindi-reading worker saw
 * "छाया में जाएँ" above "Keep shaded recovery space available to the crew". The title comes
 * from `actionCode`; the instruction was a server-authored English sentence rendered verbatim.
 *
 * This file uses the real i18n instance, because a stubbed `t` returning its key cannot tell a
 * translated card from an untranslated one — every assertion would pass either way.
 *
 * @author Justin Chua
 */
import { I18nextProvider } from "react-i18next";
import { act, render } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => jest.requireActual("@/styles/theme").defaultTheme,
}));
jest.mock("@/hooks/useReduceMotion", () => ({
  useReduceMotion: () => true,
  useSystemReduceMotion: () => true,
  useReduceMotionPreference: () => true,
}));

import i18n from "@/localization/i18n";
import DispatchCard from "./DispatchCard";
import type { ActionDispatch } from "@/types/domain";

function dispatchFixture(overrides: Partial<ActionDispatch> = {}): ActionDispatch {
  return {
    id: "d1",
    approvalId: "a1",
    workerId: "w1",
    // The DISPATCH code, which is what actually arrives — SHADE_RECOVERY dispatches as this.
    actionCode: "SEEK_SHADE",
    instruction: "Keep shaded recovery space available to the crew",
    startTime: null,
    endTime: null,
    status: "PENDING",
    dispatchedAt: "2026-08-20T14:09:00.000Z",
    ...overrides,
  } as ActionDispatch;
}

async function renderIn(language: string, dispatch = dispatchFixture()) {
  await act(async () => {
    await i18n.changeLanguage(language);
  });

  return render(
    <I18nextProvider i18n={i18n}>
      <DispatchCard
        dispatch={dispatch}
        acknowledgedAt={null}
        inFlight={false}
        failureKey={null}
        onAcknowledge={jest.fn()}
        locale={language}
      />
    </I18nextProvider>,
  );
}

/** Every text node, joined — so "is the English still here?" is one assertion. */
function allText(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(allText).join(" ");
  if (node && typeof node === "object" && "children" in node) {
    return allText((node as { children?: unknown }).children ?? []);
  }
  return "";
}

afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("the instruction follows the worker's language", () => {
  it.each([
    ["Hindi", "hi"],
    ["Malay", "ms"],
    ["Chinese", "zh-Hans"],
    ["Tamil", "ta"],
    ["Bengali", "bn"],
    ["Burmese", "my"],
  ])("translates a canned instruction into %s", async (_name, language) => {
    const { toJSON } = await renderIn(language);

    const text = allText(toJSON());
    expect(text).toContain(i18n.t("actionInstructions.SHADE_RECOVERY"));
    // The reported symptom, as an assertion.
    expect(text).not.toContain("Keep shaded recovery space available to the crew");
  });

  it("distinguishes the two hydration sentences under one dispatch code", async () => {
    /*
     * Both arrive as HYDRATE. Keying the translation on `actionCode` would have rendered one
     * of these for the other — and they say different things about how often to drink.
     */
    const hourly = await renderIn(
      "ms",
      dispatchFixture({
        actionCode: "HYDRATE",
        instruction: "Drink water every hour, roughly one cup per break",
      }),
    );
    expect(allText(hourly.toJSON())).toContain(i18n.t("actionInstructions.HYDRATE_HOURLY"));

    const regularly = await renderIn(
      "ms",
      dispatchFixture({
        actionCode: "HYDRATE",
        instruction: "Drink water regularly throughout the shift",
      }),
    );
    expect(allText(regularly.toJSON())).toContain(
      i18n.t("actionInstructions.HYDRATE_REGULARLY"),
    );
  });

  it("still reads correctly in English", async () => {
    const { toJSON } = await renderIn("en");

    expect(allText(toJSON())).toContain("Keep shaded recovery space available to the crew");
  });
});

describe("what it must not overwrite", () => {
  it("shows a supervisor's edited instruction exactly as written", async () => {
    /*
     * The line this fix must not cross. A supervisor rewrote a safety instruction for this
     * specific site; replacing it with the canned translation would hand the worker generic
     * advice and say nothing about the substitution.
     */
    const edited = "Drink water at the north tap only, the west one is out of service";
    const { toJSON } = await renderIn("ms", dispatchFixture({ instruction: edited }));

    expect(allText(toJSON())).toContain(edited);
  });

  it("falls back to the placeholder when there is no instruction at all", async () => {
    const { toJSON } = await renderIn("ms", dispatchFixture({ instruction: null }));

    expect(allText(toJSON())).toContain(i18n.t("inbox.noInstruction"));
  });
});

it("re-renders when the language changes under a mounted card", async () => {
  // The bug as reported: switching language left the old text on screen.
  const { toJSON } = await renderIn("en");
  expect(allText(toJSON())).toContain("Keep shaded recovery space available to the crew");

  await act(async () => {
    await i18n.changeLanguage("hi");
  });

  const after = allText(toJSON());
  expect(after).not.toContain("Keep shaded recovery space available to the crew");
  expect(after).toContain(i18n.t("actionInstructions.SHADE_RECOVERY"));
});
