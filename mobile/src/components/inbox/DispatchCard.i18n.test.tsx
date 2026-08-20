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
    // Null by default so the existing cases still exercise the TEXT path. The code path has
    // its own block below.
    instructionCode: null,
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


/**
 * ── THE SECOND BUG, AND WHY THE FIRST FIX COULD NOT HAVE CAUGHT IT ──────────────────────
 * Everything above matches the instruction against a table copied from
 * `DeterministicPlanBuilder.ACTION_TEXT`. That table is right, and it only ever describes the
 * DETERMINISTIC FALLBACK.
 *
 * On the live Bedrock path the model writes the sentence itself — ml-service declares `action`
 * as a free 1..200 character string — so a worker with the app in Chinese saw a Chinese title
 * over an English instruction that appears in neither repository. Hence `instructionCode`.
 */
describe("the instruction code, which is what live plans actually carry", () => {
  /** Verbatim from the bug report: model prose, matching no table anywhere. */
  const MODEL_SHADE = "Take breaks in shade whenever possible to allow passive cooling";
  const MODEL_HYDRATE = "Drink water regularly throughout the shift (at least every 2 hours)";

  it.each([
    ["Chinese", "zh-Hans"],
    ["Malay", "ms"],
    ["Tamil", "ta"],
    ["Hindi", "hi"],
    ["Bengali", "bn"],
    ["Burmese", "my"],
  ])("translates model-written prose in %s", async (_name, language) => {
    const { toJSON } = await renderIn(
      language,
      dispatchFixture({ instruction: MODEL_SHADE, instructionCode: "SHADE_RECOVERY" }),
    );

    const text = allText(toJSON());
    expect(text).toContain(i18n.t("actionInstructions.SHADE_RECOVERY"));
    // The exact string from the screenshot must be gone.
    expect(text).not.toContain(MODEL_SHADE);
  });

  it("translates the model's hydration wording, parenthetical and all", async () => {
    const { toJSON } = await renderIn(
      "zh-Hans",
      dispatchFixture({
        actionCode: "HYDRATE",
        instruction: MODEL_HYDRATE,
        instructionCode: "HYDRATE_REGULARLY",
      }),
    );

    const text = allText(toJSON());
    expect(text).toContain(i18n.t("actionInstructions.HYDRATE_REGULARLY"));
    expect(text).not.toContain("at least every 2 hours");
  });

  it("keeps a lightning stop-work out of the shade", async () => {
    /*
     * The regression that would cost the most, so it is asserted in both directions. A
     * lightning stop-work carries STOP_WORK exactly like a heat stop-work; only the code
     * derived from its rule reference says the crew must get inside a building. Rendering the
     * heat sentence here would tell people to stand under a tree in a thunderstorm.
     */
    const { toJSON } = await renderIn(
      "zh-Hans",
      dispatchFixture({
        actionCode: "STOP_WORK",
        instruction: "Stop work and move to a substantial building right away",
        instructionCode: "STOP_WORK_LIGHTNING",
      }),
    );

    const text = allText(toJSON());
    expect(text).toContain(i18n.t("actionInstructions.STOP_WORK_LIGHTNING"));
    expect(text).not.toContain(i18n.t("actionInstructions.STOP_WORK"));
  });

  it("prefers the code when the code and the text disagree", async () => {
    /*
     * They disagree on every live plan, because the model re-words what the code mandates.
     * The code is the half the agent validator polices, so it wins.
     */
    const { toJSON } = await renderIn(
      "ms",
      dispatchFixture({
        instruction: "Rotate affected workers onto lighter duties",
        instructionCode: "CLOSE_MONITORING",
      }),
    );

    const text = allText(toJSON());
    expect(text).toContain(i18n.t("actionInstructions.CLOSE_MONITORING"));
    expect(text).not.toContain(i18n.t("actionInstructions.ROTATE_TO_LIGHT_DUTY"));
  });

  it("still translates a pre-migration dispatch that has no code", async () => {
    // Rows written before the backend's V25 migration carry null and cannot be backfilled.
    // The text match is what recovers them, which is why it is kept rather than deleted.
    const { toJSON } = await renderIn(
      "ta",
      dispatchFixture({ instructionCode: null, instruction: "Rotate affected workers onto lighter duties" }),
    );

    expect(allText(toJSON())).toContain(i18n.t("actionInstructions.ROTATE_TO_LIGHT_DUTY"));
  });

  it("never renders a raw translation key for a code it does not know", async () => {
    /*
     * A code added to the backend catalogue ahead of this app's translations. English a worker
     * can act on beats "actionInstructions.SOMETHING_NEW", which they cannot.
     */
    const bespoke = "Move the crew to the east muster point and wait there";
    const { toJSON } = await renderIn(
      "bn",
      dispatchFixture({ instructionCode: "SOMETHING_NEW", instruction: bespoke }),
    );

    const text = allText(toJSON());
    expect(text).toContain(bespoke);
    expect(text).not.toContain("actionInstructions.");
  });

  it("re-renders on a language change under a mounted card", async () => {
    const { toJSON } = await renderIn(
      "en",
      dispatchFixture({ instruction: MODEL_SHADE, instructionCode: "SHADE_RECOVERY" }),
    );
    expect(allText(toJSON())).toContain(i18n.t("actionInstructions.SHADE_RECOVERY"));

    await act(async () => {
      await i18n.changeLanguage("zh-Hans");
    });

    expect(allText(toJSON())).toContain(i18n.t("actionInstructions.SHADE_RECOVERY"));
  });
});
