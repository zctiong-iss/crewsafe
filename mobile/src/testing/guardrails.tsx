/**
 * The ADR-0017 §6 guardrail gate, as something a machine runs.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────
 * ADR-0017 declares the gate a merge blocker, but the design doc defines it as "run the plan
 * screen and eyeball": six checks — large text, high contrast, long rule codes, chip
 * overflow, seven languages, no clipping — repeated per screen, per language, by hand. That
 * is a checklist someone follows for the first two tickets of a three-phase programme and
 * then stops following, and the things it stops checking are the ones that decide whether a
 * supervisor can read a stop-work instruction in the sun.
 *
 * So the gate is a matrix render instead. `renderUnderGuardrails` mounts a component under
 * every combination that the manual list describes, and the assertions below encode what
 * "survives" means.
 *
 * ── WHAT THIS CAN AND CANNOT CATCH ──────────────────────────────────────────────────────
 * It runs against the React test renderer, which has no layout engine: there are no real
 * pixel boxes, so it cannot see a label that visually overflows its container by three
 * points. What it CAN see is every *cause* of clipping that lives in the style tree —
 * `numberOfLines` clamps, fixed `maxWidth`/`height` on a text-bearing box, `overflow:
 * hidden` — and it can see that a component renders at all under high contrast, at
 * fontScale 1.5, and in Tamil rather than throwing.
 *
 * That is the honest boundary. It replaces the mechanical half of the eyeball pass, not the
 * judgement half; a human still looks at the screen before shipping a phase.
 *
 * @author Justin Chua
 */
import type { ReactElement } from "react";
import { render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { buildTheme, FONT_SCALE_MAX, type AppTheme } from "@/styles/theme";

/**
 * The languages the gate renders in.
 *
 * Not all seven: these are the ones carrying a per-script font and a line-height boost, so
 * they are where a caption-height box clips first. `en` is the control (Lexend).
 *
 * `hi` joined when Hindi moved off the system Devanagari fallback onto Noto Sans Devanagari —
 * before that its face was whatever the device happened to have, so gating it would have
 * asserted something the app did not control. `ms` (Latin, identical to `en`) and `zh-Hans`
 * (system CJK face, still outside the app's control) stay out for the same reason.
 */
export const GATE_LANGUAGES = ["en", "ta", "bn", "my", "hi"] as const;

/** The two ends of the text-size range, since the cap is where layouts fail. */
export const GATE_FONT_SCALES = [1, FONT_SCALE_MAX] as const;

export interface GuardrailCase {
  language: string;
  fontScale: number;
  highContrast: boolean;
  theme: AppTheme;
  /** `en · 1.5 · high-contrast` — used as the test name so a failure names its cell. */
  label: string;
}

/** Every cell of the gate: language × font scale × contrast. */
export function guardrailCases(): GuardrailCase[] {
  const cases: GuardrailCase[] = [];
  for (const language of GATE_LANGUAGES) {
    for (const fontScale of GATE_FONT_SCALES) {
      for (const highContrast of [false, true]) {
        cases.push({
          language,
          fontScale,
          highContrast,
          theme: buildTheme(highContrast, fontScale),
          label: `${language} · ${fontScale} · ${highContrast ? "high-contrast" : "standard"}`,
        });
      }
    }
  }
  return cases;
}

/**
 * A long rule code and a long crew, as the gate specifies them.
 *
 * `UNACCLIMATISED_HEAVY_WORK_RULE` is the literal string ADR-0017 §6 names — it is the
 * longest real code the policy engine emits and has no break opportunity in it, so it is the
 * worst case for a row that must wrap rather than truncate.
 */
export const LONG_RULE_CODE = "UNACCLIMATISED_HEAVY_WORK_RULE";
export const LONG_CREW = ["w-1", "w-2", "w-3", "w-4", "w-5", "w-6", "w-7", "w-8"];

/** Names long enough to force chip wrapping, in a script with a taller line box. */
export const LONG_WORKER_NAME = "Muhammad Ridzuan bin Abdullah";

type Rendered = Awaited<ReturnType<typeof render>>;

/** One host node in the rendered output — what `toJSON()` produces. */
interface JsonNode {
  type: string;
  props: Record<string, unknown>;
  children: (JsonNode | string)[] | null;
}

/**
 * Every host node in the tree, flattened.
 *
 * Walks `toJSON()` rather than a `findAll` on the internal instance tree: the JSON output is
 * RNTL's public, stable shape, and it carries exactly what the gate inspects — resolved
 * props and styles on real host components.
 */
function hostNodes(tree: Rendered): JsonNode[] {
  const root = tree.toJSON();
  const found: JsonNode[] = [];

  const walk = (node: JsonNode | string | null): void => {
    if (node === null || typeof node === "string") return;
    found.push(node);
    for (const child of node.children ?? []) walk(child);
  };

  if (Array.isArray(root)) root.forEach((n) => walk(n as JsonNode));
  else walk(root as JsonNode | null);

  return found;
}

/** The literal text a node renders, when its children are all strings — otherwise null. */
function ownText(node: JsonNode): string | null {
  const children = node.children;
  if (!children || children.length === 0) return null;
  if (!children.every((child) => typeof child === "string")) return null;
  return (children as string[]).join("");
}

/**
 * Renders `element` under one guardrail cell.
 *
 * The caller supplies the element already wired to whatever mocks its own suite uses — this
 * helper deliberately does not own the theme or i18n mock, because every suite in this repo
 * declares those at module scope and a second source of truth would silently win or lose
 * depending on import order.
 */
export async function renderUnderGuardrails(element: ReactElement): Promise<Rendered> {
  return render(element);
}

/**
 * Asserts nothing in the tree clips its own text.
 *
 * Three failure modes, all of which are style-tree facts rather than layout facts:
 *
 *   `numberOfLines` on a text node that is not deliberately clamped — the origin pill's old
 *   `numberOfLines={1}` truncated "Required" at fontScale 1.5, and it is invisible in English
 *   at the default size.
 *
 *   A fixed `maxWidth` or `height` on a box containing text — the same pill's `maxWidth:
 *   s(110)` was sized for English and had no room for Tamil.
 *
 *   `overflow: "hidden"` on such a box, which turns an overflow into a silent crop.
 *
 * `allowedClamps` lists text that is clamped ON PURPOSE — the three-line "Why this was
 * drafted" narrative is a designed clamp with a Read more control behind it, not a defect.
 */
export function expectNoClipping(tree: Rendered, allowedClamps: string[] = []): void {
  const offenders: string[] = [];

  for (const node of hostNodes(tree)) {
    const flat = (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
    const text = ownText(node);
    if (!text || allowedClamps.includes(text)) continue;

    const clamp = node.props.numberOfLines;
    if (clamp !== undefined && clamp !== null) {
      offenders.push(`numberOfLines=${formatDiagnosticValue(clamp)} on "${text}"`);
    }
    if (typeof flat.maxWidth === "number") {
      offenders.push(`fixed maxWidth=${flat.maxWidth} around "${text}"`);
    }
    if (typeof flat.height === "number") {
      offenders.push(`fixed height=${flat.height} around "${text}"`);
    }
    if (flat.overflow === "hidden") {
      offenders.push(`overflow:hidden around "${text}"`);
    }
  }

  expect(offenders).toEqual([]);
}

/** Formats arbitrary host props without collapsing objects to the unhelpful `[object Object]`. */
export function formatDiagnosticValue(value: unknown): string {
  if (value === null || typeof value !== "object") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable object]";
  }
}

/**
 * Asserts every pill and chip in the tree carries a visible edge.
 *
 * The high-contrast case is the reason: `surfaceAlt` collapses to `surface`, so a chip that
 * relied on its fill has nothing left. Any node with a `borderRadius` and a `borderColor` is
 * treated as a pill; it must also have a non-zero `borderWidth`.
 */
export function expectPillsBordered(tree: Rendered): void {
  const offenders: string[] = [];

  for (const node of hostNodes(tree)) {
    const flat = (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
    const looksLikeAPill = flat.borderRadius !== undefined && flat.borderColor !== undefined;
    if (looksLikeAPill && !flat.borderWidth) {
      offenders.push(`pill with borderColor ${String(flat.borderColor)} has no borderWidth`);
    }
  }

  expect(offenders).toEqual([]);
}

/**
 * Asserts every interactive control is at least 44pt tall.
 *
 * A caption-sized disclosure row is about 16pt of text; without an explicit `minHeight` it
 * becomes a target too small to hit with a gloved hand on uneven ground, which is the
 * condition this app is used in.
 */
export function expectTouchTargets(tree: Rendered, minimum = 44): void {
  const offenders: string[] = [];

  for (const node of hostNodes(tree)) {
    if (node.props.accessibilityRole !== "button") continue;
    const flat = (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
    const height = flat.minHeight ?? flat.height;
    // `undefined` means the control is sized by a parent or by its own padding, which this
    // renderer cannot resolve — only an explicitly too-small box is a finding.
    if (typeof height === "number" && height < minimum) {
      offenders.push(`${String(node.props.accessibilityLabel)} is ${height}pt tall`);
    }
  }

  expect(offenders).toEqual([]);
}
