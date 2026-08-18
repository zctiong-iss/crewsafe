/**
 * Runtime accessibility assertion for component/page tests (SCRUM-436).
 *
 * Wraps axe-core (via vitest-axe) so a test can assert its rendered output carries no WCAG
 * violations. Self-contained on purpose — it uses only vitest-axe's `axe` runner and a plain
 * `expect`, rather than registering the library's custom matcher, because this version of
 * vitest-axe ships an empty `extend-expect` entry and no `exports` map for the matcher subpath.
 * A failure prints each violation's rule, impact and help URL, so the report says what to fix,
 * not just that something is wrong.
 *
 * @author Tang Chee Seng
 */
import { axe } from "vitest-axe";
import { expect } from "vitest";

export async function expectNoA11yViolations(container: Element): Promise<void> {
  const results = await axe(container, {
    // jsdom does not lay out or paint, so it cannot evaluate colour contrast — axe would
    // either skip it silently or report noise. Contrast is owned by the separate CVD/contrast
    // audit against tokens.css, not by this runtime check.
    rules: { "color-contrast": { enabled: false } },
  });

  const message = results.violations
    .map(
      (violation) =>
        `[${violation.impact ?? "unknown"}] ${violation.id}: ${violation.help}` +
        ` (${violation.nodes.length} node(s))\n  ${violation.helpUrl}`,
    )
    .join("\n");

  expect(results.violations, message).toHaveLength(0);
}
