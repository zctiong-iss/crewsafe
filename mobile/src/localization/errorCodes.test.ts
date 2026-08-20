/**
 * Every `ApiErrorCode` must have a translation in every locale.
 *
 * `messageKeyFor` returns `errors.codes.<CODE>` the moment the backend names a code, and i18n
 * renders a missing key as the key itself — so a code added to the union without a matching
 * string would put the literal text "errors.codes.NO_ACTIVE_POLICY" in front of a supervisor,
 * in an alert whose whole purpose is to explain what went wrong. That failure is invisible to
 * `tsc` because translation files are plain JSON, which is what this test is for.
 *
 * @author Justin Chua
 */
import bn from "./bn.json";
import en from "./en.json";
import hi from "./hi.json";
import ms from "./ms.json";
import my from "./my.json";
import ta from "./ta.json";
import zhHans from "./zh-Hans.json";

/**
 * Mirrors the `ApiErrorCode` union in `api/errors.ts`. Kept as a literal rather than imported
 * from the type, because a type cannot be enumerated at runtime — and `KNOWN_ERROR_CODES` is
 * asserted against this same list in `api/errors.test.ts`, so the three stay in step.
 */
const ERROR_CODES = [
  "NO_ACTIVE_POLICY",
  "NO_USABLE_WBGT",
  "WORKER_HAS_OVERLAPPING_SHIFT",
  "SHIFT_NOT_EDITABLE",
] as const;

const LOCALES: Record<string, { errors: { codes?: Record<string, string> } }> = {
  en,
  bn,
  hi,
  ms,
  my,
  ta,
  "zh-Hans": zhHans,
};

describe("errors.codes translations", () => {
  it.each(Object.keys(LOCALES))("%s defines every error code", (locale) => {
    const codes = LOCALES[locale].errors.codes ?? {};
    for (const code of ERROR_CODES) {
      expect(typeof codes[code]).toBe("string");
      expect(codes[code].trim().length).toBeGreaterThan(0);
    }
  });

  /*
   * A leftover translation for a code that no longer exists is dead weight that reads as
   * supported. Caught here rather than left to rot, the same reason `features.ts` prefers a
   * flag over commented-out JSX.
   */
  it.each(Object.keys(LOCALES))("%s defines no codes beyond the union", (locale) => {
    const codes = Object.keys(LOCALES[locale].errors.codes ?? {});
    expect(codes.sort()).toEqual([...ERROR_CODES].sort());
  });

  /*
   * Guards against copy-paste: a locale that shipped the English string verbatim is almost
   * certainly untranslated. English itself is excluded for the obvious reason.
   */
  it.each(Object.keys(LOCALES).filter((locale) => locale !== "en"))(
    "%s does not reuse the English wording",
    (locale) => {
      const codes = LOCALES[locale].errors.codes ?? {};
      for (const code of ERROR_CODES) {
        expect(codes[code]).not.toBe(en.errors.codes[code]);
      }
    },
  );
});
