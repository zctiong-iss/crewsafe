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

function placeholders(text) {
  return [...text.matchAll(/{{\s*([\w.-]+)\s*}}/g)].map((match) => match[1]).sort();
}

function load(code) {
  return JSON.parse(readFileSync(join(LOCALE_DIR, `${code}.json`), "utf8"));
}

const locales = readdirSync(LOCALE_DIR)
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.replace(/\.json$/, ""))
  .filter((code) => code !== SOURCE)
  .sort();

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

  const ok = missing.length === 0 && extra.length === 0 && placeholderMismatches.length === 0;
  console.log(`${ok ? "PASS" : "FAIL"}  ${code}.json  (${target.size} keys)`);

  if (!ok) {
    failed = true;
    for (const key of missing) console.log(`        missing: ${key}`);
    for (const key of extra) console.log(`        not in ${SOURCE}: ${key}`);
    for (const m of placeholderMismatches) {
      console.log(`        placeholders differ: ${m.key} — expected {{${m.want.join("}}, {{")}}}, got ${m.got.length ? `{{${m.got.join("}}, {{")}}}` : "none"}`);
    }
  }
}

if (failed) {
  console.error("\nLocale parity check failed. A missing key renders as English on a safety screen.");
  process.exit(1);
}

console.log("\nAll locales in parity.");
