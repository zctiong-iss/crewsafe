/**
 * Turns an untranslated action code into something readable.
 *
 * `action_code` is deliberately not CHECK-constrained server-side (V3__domain_schema.sql),
 * so the catalogue can grow ahead of this app's translations and a code will sometimes
 * reach the UI with no entry in the locale files.
 *
 * Rendering it verbatim is worse than it looks. `ROTATE_TO_LIGHT_DUTY` contains no spaces,
 * so there is nowhere to wrap: the text breaks mid-word and leaves an orphaned character on
 * the second line. Converting to "Rotate to light duty" both shortens it — often onto one
 * line — and gives real word boundaries to wrap at when it does not.
 */
export function humaniseActionCode(code: string): string {
  const words = code.replace(/[_-]+/g, " ").trim().toLowerCase();
  if (words.length === 0) return code;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
