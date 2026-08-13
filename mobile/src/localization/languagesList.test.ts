/**
 * languagesList (SCRUM-352 / FR-006, SCRUM-205).
 *
 * `resolveDeviceLanguage` is what stands between a first launch and a worker staring at a
 * language they cannot read — see the file's own header comment for why Indonesian
 * deliberately falls through to English rather than guessing at Malay, and why Traditional
 * Chinese does the same rather than silently showing Simplified. Asserts every mapped
 * language, both fallback cases, and the multi-locale-list matching order.
 */
import { isSupportedLanguage, resolveDeviceLanguage, supportedLanguages } from "./languagesList";

describe("isSupportedLanguage", () => {
  it("recognises every shipped language code", () => {
    for (const code of supportedLanguages) {
      expect(isSupportedLanguage(code)).toBe(true);
    }
  });

  it("rejects a code the app does not ship", () => {
    expect(isSupportedLanguage("fr")).toBe(false);
  });
});

describe("resolveDeviceLanguage", () => {
  it.each([
    ["en-US", "en"],
    ["hi-IN", "hi"],
    ["ms-SG", "ms"],
    ["ta-SG", "ta"],
    ["bn-BD", "bn"],
    ["my-MM", "my"],
    ["mya", "my"],
    ["bur", "my"],
    ["zh-Hans-SG", "zh-Hans"],
    ["zh-CN", "zh-Hans"],
  ])("maps device locale %s to %s", (tag, expected) => {
    expect(resolveDeviceLanguage([tag])).toBe(expected);
  });

  it("falls through Traditional Chinese to English rather than showing Simplified", () => {
    // A prefix match on the bare `zh` subtag would wrongly map Traditional onto Simplified —
    // this is the guard against that, per the file's own header comment.
    expect(resolveDeviceLanguage(["zh-Hant-TW"])).toBe("en");
    expect(resolveDeviceLanguage(["zh-HK"])).toBe("en");
    expect(resolveDeviceLanguage(["zh-MO"])).toBe("en");
  });

  it("falls through Indonesian to English rather than guessing at Malay", () => {
    // Close enough to be mutually intelligible in writing, but not in the safety/workplace
    // register this app lives in — showing an Indonesian speaker Malay would be a guess
    // made on their behalf about a stop-work instruction.
    expect(resolveDeviceLanguage(["id-ID"])).toBe("en");
  });

  it("defaults to English when no locale in the list is supported", () => {
    expect(resolveDeviceLanguage(["fr-FR", "de-DE"])).toBe("en");
  });

  it("defaults to English for an empty locale list", () => {
    expect(resolveDeviceLanguage([])).toBe("en");
  });

  it("tries each locale in order until one matches", () => {
    // The device's first preference is unsupported; the second is Tamil.
    expect(resolveDeviceLanguage(["fr-FR", "ta-SG"])).toBe("ta");
  });
});
