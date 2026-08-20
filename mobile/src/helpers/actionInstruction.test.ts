/**
 * Which dispatched instructions may be translated, and which must be left alone.
 *
 * The dangerous direction here is not a missing translation — it is translating something a
 * supervisor deliberately wrote. If they edited "Drink water regularly" into "Drink water at
 * the north tap only", replacing that with the canned sentence would hand a worker generic
 * advice in place of a specific safety instruction, and nothing on screen would say so.
 *
 * @author Justin Chua
 */
import { instructionKeyFor, CANNED_INSTRUCTION_CODES } from "./actionInstruction";
import en from "@/localization/en.json";

describe("the canned sentences", () => {
  it.each([
    ["SHADE_RECOVERY", "Keep shaded recovery space available to the crew"],
    ["HYDRATE_REGULARLY", "Drink water regularly throughout the shift"],
    ["HYDRATE_HOURLY", "Drink water every hour, roughly one cup per break"],
    ["REST_15_MIN_HOURLY", "Take a 15-minute rest break in shade every hour"],
    ["STOP_WORK", "Stop work immediately and move the crew to a cool, shaded area"],
  ])("maps the %s sentence to its key", (code, sentence) => {
    expect(instructionKeyFor(sentence)).toBe(`actionInstructions.${code}`);
  });

  it("tells the two hydration sentences apart", () => {
    /*
     * The case that rules out keying on `actionCode`. HYDRATE_HOURLY and HYDRATE_REGULARLY
     * both arrive on a dispatch as HYDRATE — the code cannot choose between them, and the two
     * sentences say different things about how often to drink.
     */
    expect(instructionKeyFor("Drink water every hour, roughly one cup per break")).toBe(
      "actionInstructions.HYDRATE_HOURLY",
    );
    expect(instructionKeyFor("Drink water regularly throughout the shift")).toBe(
      "actionInstructions.HYDRATE_REGULARLY",
    );
  });

  it("tells the two stop-work sentences apart", () => {
    // Both carry the STOP_WORK code; only one is the lightning wording, which sends people to
    // a building rather than to shade. Shade is the wrong instruction during a storm.
    expect(
      instructionKeyFor("Stop work and move the crew to a substantial building or a fully enclosed vehicle"),
    ).toBe("actionInstructions.STOP_WORK_LIGHTNING");
  });

  it("ignores whitespace differences", () => {
    // Formatting noise, not wording. Leading or doubled spaces should not cost a translation.
    expect(instructionKeyFor("  Drink water regularly   throughout the shift ")).toBe(
      "actionInstructions.HYDRATE_REGULARLY",
    );
  });
});

describe("what must NOT be translated", () => {
  it("leaves a supervisor's edit alone", () => {
    /*
     * The whole reason this matches on text. A supervisor edited the plan before approving it,
     * and their sentence is the instruction — replacing it with the canned one would discard a
     * deliberate decision about this specific crew and site.
     */
    expect(instructionKeyFor("Drink water at the north tap only, it is the one that works")).toBeNull();
  });

  it("leaves a sentence that merely resembles a canned one", () => {
    // One added clause makes it someone's wording, not the server's.
    expect(
      instructionKeyFor("Drink water regularly throughout the shift, and tell your supervisor if you feel unwell"),
    ).toBeNull();
  });

  it("does not match on case alone", () => {
    /*
     * Deliberately strict. Case folding would start treating near-misses as canned, and the
     * cost of that mistake falls on the worker rather than on the developer.
     */
    expect(instructionKeyFor("drink water regularly throughout the shift")).toBeNull();
  });

  it("returns null for nothing at all", () => {
    expect(instructionKeyFor(null)).toBeNull();
    expect(instructionKeyFor(undefined)).toBeNull();
    expect(instructionKeyFor("   ")).toBeNull();
  });
});

describe("the table stays in step with the translations", () => {
  it("has a translation for every canned sentence", () => {
    /*
     * This table mirrors `DeterministicPlanBuilder.ACTION_TEXT` by hand, so the two can drift.
     * A code with no key would match and then render the key itself to a worker, which is
     * worse than the English it replaced.
     *
     * Locale parity is enforced separately by `check:locales`, so covering `en` covers all
     * seven.
     */
    const translated = Object.keys((en as { actionInstructions: Record<string, string> }).actionInstructions);

    expect(CANNED_INSTRUCTION_CODES.sort()).toEqual(translated.sort());
  });
});
