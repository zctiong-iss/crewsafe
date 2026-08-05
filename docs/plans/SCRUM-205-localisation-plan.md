# SCRUM-205 — Bengali, Burmese, Malay and Tamil localisation plan

## Outcome

CrewSafe will ship seven interface languages instead of three, adding Bengali (`bn`),
Burmese (`my`), Malay (`ms`) and Tamil (`ta`) alongside the existing English, Simplified
Chinese and Hindi. Each is selectable from Settings and from the sign-in screen, listed in
its own script, resolved from the device locale on first launch, and persisted across
reloads by the existing `preferences.language` path.

FR-26c is the reason and also the limit: a worker who cannot read an instruction cannot
follow it, and a stop-work notice they cannot read is not a warning. That makes translation
quality a safety property here rather than a polish one, and the plan treats it as such.

## Blocking constraint

The application's global typeface is Gelasio (`mobile/src/styles/fonts.ts`), loaded from
`@expo-google-fonts/gelasio` as four hardcoded family constants. Gelasio covers Latin,
Cyrillic and Greek. **It has no glyphs for Bengali, Myanmar or Tamil.**

Three of the four new languages are therefore unrenderable until the font layer changes.
The failure is not loud: depending on platform the text either draws as tofu boxes or falls
back silently to whatever system face exists, which on Android may be absent entirely. A
translated string that renders as boxes is worse than an untranslated one, because the
untranslated one is at least readable by someone.

Malay is Latin script and renders correctly in Gelasio today. It is the only one of the four
that could ship on translation alone.

## Measured scope

Taken from `mobile/src/localization/en.json` at the SCRUM-196/197 merge:

| Measure | Value |
| --- | --- |
| Translatable keys per language | 280 |
| Source characters per language | ~7,629 |
| Keys containing `{{interpolation}}` | 29 |
| Keys with plural forms (`_one` / `_other`) | 2 |
| New strings across four languages | 1,120 |

Interpolated and plural keys are called out because they cannot be handed to a translator as
flat text — the placeholder names are load-bearing and i18next's plural suffixes differ by
language's plural-category count.

## Approved design

- `languagesArr` in `mobile/src/localization/languagesList.ts` gains four entries, each
  labelled in its own script — বাংলা, မြန်မာ, Bahasa Melayu, தமிழ். A worker looking for
  their language must not have to read English to find it. `AppLanguage` widens from the
  same array, so the type follows without a second edit.
- `resolveDeviceLanguage` gains prefix matches for `bn`, `my`, `ms` and `ta`. The existing
  `zh-Hant` carve-out stands: Traditional Chinese continues to fall through to English
  rather than being shown the wrong script.
- `i18n.ts` registers four new resource bundles, imported statically like the current three.
  A worker who loses signal mid-shift must not lose their language.
- `AppFonts` stops being four constants and becomes a per-language resolution. Noto Sans
  Bengali, Noto Sans Myanmar and Noto Sans Tamil are added from `@expo-google-fonts/*`.
  Weight coverage is verified per script rather than assumed: Noto subsets do not uniformly
  ship all four of regular/medium/semiBold/bold, and a missing weight degrades to a silent
  fallback of exactly the kind `fonts.ts` was written to prevent.
- `lineHeightFor` in `AppText` is tuned for Gelasio's Latin metrics. Bengali, Myanmar and
  Tamil carry taller ascenders, deeper descenders and stacked diacritics, and will clip
  against the current line boxes. Line height becomes script-aware.
- No RTL work. All four languages are left-to-right.

## Delivery sequence

Seven issues under one epic. The order is a dependency, not a preference.

1. **Font loading and line metrics** for Bengali, Myanmar and Tamil. Blocks 3, 4 and 5.
2. **Malay** — translation and wiring only, no font work.
3. **Tamil**.
4. **Bengali**.
5. **Burmese**, including the Zawgyi decision below.
6. **CI key-parity check** across all locale files. Independent; pull forward.

Malay is deliberately second rather than batched with the others. It exercises the entire
add-a-language path — `languagesArr`, the `AppLanguage` type, `resolveDeviceLanguage`,
resource registration, the language sheet and the sign-in picker — with the font problem
held out. Anything that breaks there breaks for the other three, and it is far cheaper to
diagnose when tofu is not also on screen.

The key-parity check is ten lines of Node and should land early. At seven locales × 280 keys
a missing key does not error or crash: it renders the English string in the middle of an
otherwise Tamil screen, on a safety surface, to a worker who may not read English. The same
check has been run by hand for SCRUM-196/197 and SCRUM-199/200; automating it removes the
step where someone forgets.

## Burmese and the Zawgyi split

Myanmar text on Android carries a long-standing encoding split between Zawgyi and Unicode.
A device still on Zawgyi renders correct Unicode as garbled text. The failure looks like a
bad translation rather than an encoding problem, which is how it survives review.

The Burmese issue must make the choice explicitly — detect and handle Zawgyi, or declare
Unicode-only — and record it in `mobile/README.md`. An undocumented choice here is
indistinguishable from not having considered it, and the next person to see garbled Burmese
will go looking for a translator rather than a font stack.

## Translation quality boundary

Machine translation is not acceptable for the safety strings. `lightning.stopWorkTitle`,
`lightning.stopWorkBody`, and the whole `actions.*` and `guidance.*` blocks require
native-speaker review before release. A mistranslated stop-work instruction is an incident,
not a typo.

If native review is not available for a language when the rest of its translation is ready,
the language does not ship silently degraded. FR-26c's language-neutral pictogram
requirement is the specified fallback for an unsupported language, and shipping general UI
in a language whose safety strings are unreviewed forfeits that protection — the worker
believes they are being addressed in their own language precisely where they are not.

## Layout risk

Tamil and Bengali commonly run 20–40% longer than the English source. The surfaces already
documented as tight are the ones to check first:

- the lightning banner title, which wraps against a fixed-size icon;
- `SegmentedControl` intensity labels, which are fixed-width by construction;
- the tab bar;
- Settings' font-scale radio rows, which clip past 1.5× today.

The text-size cap of 1.5× is not raised by this work. Verification is at default and 1.5×,
which are the two ends that matter.

## Acceptance and evidence

- All 280 keys present in each of `bn.json`, `my.json`, `ms.json` and `ta.json`; the
  key-parity check reports zero missing and zero extra across all seven locales.
- `tsc --noEmit` clean.
- Every script renders with no tofu and no silent system fallback, on Android **and** iOS, at
  all four text-size settings and in both standard and high-contrast palettes.
- Each language reachable from Settings and from the sign-in screen, listed in its own
  script.
- Device-locale detection maps `bn*`, `my*`, `ms*` and `ta*` correctly on first launch, and
  `zh-Hant` still falls through to English.
- Selection survives an app reload.
- No clipped label, overlapping control, or text overflowing a card in any language at
  default or 1.5× text scale — screenshotted per language at both.
- Safety strings signed off by a native speaker, per language, recorded against the issue.

## Dependencies and boundaries

Backend localisation is out of scope and unnecessary: every error message is already a
translation key resolved client-side, including those derived from HTTP status.

Traditional Chinese stays out of scope and continues to fall through to English by the
existing deliberate carve-out in `resolveDeviceLanguage`.

The FR-26c pictogram set for genuinely unsupported languages is separate work. This plan
depends on it only as the stated fallback when a language's safety strings are unreviewed.

Verification is limited by what the project can currently exercise: the mobile app has been
driven on an Android emulator and **never on iOS**. Four new scripts is the change most
likely to expose that gap, since text shaping and font fallback are among the areas where
the two platforms differ most.
