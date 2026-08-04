/**
 * Fails the build when any locale drifts from `en.json`.
 *
 * ── WHY THIS IS NOT OPTIONAL ────────────────────────────────────────────────────────────
 * A missing key does not error, warn, or crash. i18next falls back to `en`, so the string
 * simply renders in English — in the middle of an otherwise translated screen, on a safety
 * surface, to a worker who may not read English. That is the exact failure FR-26c exists to
 * prevent, and it is invisible to `tsc`, to the bundler, and to anyone reviewing a diff of
 * a language they do not speak.
 *
 * The check has been run by hand for SCRUM-196/197 and SCRUM-199/200. At four locales and
 * 280 keys that was already tedious; at seven it is a step someone forgets. This is the
 * same comparison, wired to fail loudly.
 *
 * ── WHAT IT CHECKS ──────────────────────────────────────────────────────────────────────
 *   1. No key in `en.json` is missing from any other locale.
 *   2. No locale carries a key `en.json` does not have — a stale key left behind by a
 *      removal is how a translator's work silently stops being rendered.
 *   3. Every `{{placeholder}}` in a source string survives translation. A dropped
 *      `{{time}}` renders as a sentence with a hole in it; a renamed one renders the
 *      literal braces to the user.
 *   4. No string is written in the wrong script for its file — Bengali text inside
 *      `ta.json`, say. This one was added because it actually happened while drafting
 *      SCRUM-205's three new locales: a single value in the Tamil file was Bengali, and
 *      nothing in the toolchain noticed. It is valid JSON, it has the right key, it has the
 *      right placeholders, and it is unreadable to the person it was written for. Reviewers
 *      cannot catch it either unless they happen to read both scripts.
 *
 * Keys beginning with `_` are metadata (see `_translationStatus`) and are skipped
 * throughout.
 *
 * Usage: `npm run check:locales`
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const LOCALE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "localization");
const SOURCE = "en";

/** Flattens to dotted paths, skipping metadata keys at any depth. */
function flatten(value, prefix = "") {
  return Object.entries(value).flatMap(([key, child]) => {
    if (key.startsWith("_")) return [];
    const path = prefix + key;
    return child !== null && typeof child === "object"
      ? flatten(child, `${path}.`)
      : [[path, String(child)]];
  });
}

/**
 * Byte-order comparison rather than `localeCompare`, and rather than a bare `sort()`.
 *
 * A bare `sort()` coerces to string and orders by UTF-16 code unit, which happens to be
 * right here but says so nowhere. `localeCompare` would be worse: it orders by the *running
 * machine's* locale, so a CI runner and a developer laptop could disagree about whether two
 * placeholder sets match. This check compares sorted lists for equality, so the only
 * property that matters is that the order is identical everywhere it runs.
 */
function byCodePoint(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function placeholders(text) {
  return [...text.matchAll(/{{\s*([\w.-]+)\s*}}/g)].map((match) => match[1]).sort(byCodePoint);
}

/** `["time", "count"]` → `{{time}}, {{count}}`, or "none" for an empty list. */
function formatPlaceholders(names) {
  if (names.length === 0) return "none";
  return names.map((name) => `{{${name}}}`).join(", ");
}

function load(code) {
  return JSON.parse(readFileSync(join(LOCALE_DIR, `${code}.json`), "utf8"));
}

/**
 * The non-Latin blocks the app ships, by the locale that should own each.
 *
 * Only these are listed: a locale absent from the map (English, Malay) is Latin and has
 * nothing to check, because Latin legitimately appears in every file — "CrewSafe", "WBGT",
 * "°C", `you@example.com` and the dev-only strings are Latin everywhere by design.
 */
const SCRIPT_BLOCKS = {
  /*
   * U+0964 and U+0965 — the danda and double danda — are excluded from the Devanagari
   * range on purpose.
   *
   * They are the Indic full stop, and although Unicode files them under Devanagari they are
   * shared punctuation: Bengali, Hindi, Assamese and others all end sentences with "।". A
   * naive block test therefore reports every correctly written Bengali sentence as
   * containing Devanagari, which is how this check first ran — four false positives in
   * bn.json before a single real one. A check that cries wolf on correct input is worse
   * than no check, because the next person turns it off.
   */
  hi: { name: "Devanagari", re: /[ऀ-ॣ०-ॿ]/ },
  bn: { name: "Bengali", re: /[ঀ-৿]/ },
  ta: { name: "Tamil", re: /[஀-௿]/ },
  my: { name: "Myanmar", re: /[က-႟]/ },
  "zh-Hans": { name: "Han", re: /[一-鿿]/ },
};

/**
 * Any string containing a script that belongs to a *different* locale.
 *
 * Deliberately not "every string must contain the expected script": plenty legitimately do
 * not — `common.appName` is "CrewSafe", `wbgt.reading` is "WBGT", the email placeholder is
 * Latin on purpose. Flagging those would produce noise that trains people to ignore the
 * check. Foreign *non-Latin* script is the unambiguous signal, and it is exactly the
 * copy-paste mistake this catches.
 */
function foreignScripts(code, entries) {
  const findings = [];
  for (const [key, text] of entries) {
    for (const [owner, block] of Object.entries(SCRIPT_BLOCKS)) {
      if (owner === code) continue;
      if (block.re.test(text)) findings.push({ key, script: block.name, owner });
    }
  }
  return findings;
}

const locales = readdirSync(LOCALE_DIR)
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.replace(/\.json$/, ""))
  .filter((code) => code !== SOURCE)
  .sort(byCodePoint);

const source = new Map(flatten(load(SOURCE)));
let failed = false;

console.log(`Locale parity against ${SOURCE}.json — ${source.size} keys, ${locales.length} locale(s)\n`);

for (const code of locales) {
  const target = new Map(flatten(load(code)));
  const missing = [...source.keys()].filter((key) => !target.has(key));
  const extra = [...target.keys()].filter((key) => !source.has(key));

  const placeholderMismatches = [...source.entries()]
    .filter(([key]) => target.has(key))
    .map(([key, text]) => {
      const want = placeholders(text);
      const got = placeholders(target.get(key));
      return want.join() === got.join() ? null : { key, want, got };
    })
    .filter(Boolean);

  const foreign = foreignScripts(code, [...target.entries()]);

  const ok =
    missing.length === 0 &&
    extra.length === 0 &&
    placeholderMismatches.length === 0 &&
    foreign.length === 0;
  console.log(`${ok ? "PASS" : "FAIL"}  ${code}.json  (${target.size} keys)`);

  if (!ok) {
    failed = true;
    for (const key of missing) console.log(`        missing: ${key}`);
    for (const key of extra) console.log(`        not in ${SOURCE}: ${key}`);
    for (const f of foreign) {
      console.log(`        wrong script: ${f.key} contains ${f.script} (belongs in ${f.owner}.json)`);
    }
    for (const mismatch of placeholderMismatches) {
      // Both sides formatted up front: a template literal nested inside another is hard to
      // read and easy to get wrong, and this one already had a brace-counting problem
      // waiting in it.
      const want = formatPlaceholders(mismatch.want);
      const got = formatPlaceholders(mismatch.got);
      console.log(`        placeholders differ: ${mismatch.key} — expected ${want}, got ${got}`);
    }
  }
}

if (failed) {
  console.error("\nLocale parity check failed. A missing key renders as English on a safety screen.");
  process.exit(1);
}

console.log("\nAll locales in parity.");
