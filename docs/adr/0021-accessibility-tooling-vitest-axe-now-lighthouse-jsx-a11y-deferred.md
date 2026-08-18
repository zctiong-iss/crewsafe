# ADR 0021 — Accessibility tooling: vitest-axe now, jsx-a11y & Lighthouse CI deferred

**Status:** Accepted
**Date:** 2026-08-18
**Jira:** SCRUM-436

---

## Context

SCRUM-436 (`[WEB] US-31 Web accessibility & performance checks (axe/Lighthouse)`) planned a
three-layer accessibility net for the web app:

1. **`eslint-plugin-jsx-a11y`** — static lint rules catching a11y mistakes in JSX at authoring
   time (missing `alt`, invalid ARIA, unlabelled controls).
2. **`vitest-axe`** — axe-core run against the *rendered* DOM inside the existing unit suite,
   catching what static analysis cannot see (issues that exist only once props/state produce real
   DOM).
3. **`@lhci/cli`** — Lighthouse CI scoring the fully-assembled page against an a11y budget as a
   pipeline gate.

On attempting to install the toolchain, two of the three did not fit the current repo.

## Decision

**Adopt `vitest-axe` now. Defer `eslint-plugin-jsx-a11y` and `@lhci/cli` to a future dedicated
accessibility-tooling task.**

Shipped in this PR:
- `web/src/test/a11y.ts` — `expectNoA11yViolations(container)` wrapping axe-core.
- axe assertions on the existing pages (Home, Shifts, Conditions, CreateShift) — **0 violations**.

Deferred, with the reasons recorded below so this is not silently re-attempted.

## Rationale

**`eslint-plugin-jsx-a11y` — deferred: no ESLint-10-compatible release.** This repo runs
ESLint 10 (flat config). jsx-a11y's latest published version (6.10.2) declares a peer range of
`eslint@"^3 || … || ^9"` — it does not admit ESLint 10, and there is no newer release or canary
that does. Installing it requires `--force`/`--legacy-peer-deps`, producing an unsupported
dependency combination that `npm ci` can reject in CI. This is a compatibility blocker, **not** a
security one — jsx-a11y's own dependency tree is clean. Revisit when a jsx-a11y release ships
ESLint-10 peer support.

**`@lhci/cli` — deferred: transitive vulnerabilities + wrong layer.** Installing `@lhci/cli`
brought **10 vulnerabilities (7 high, 1 moderate, 2 low)** into `devDependencies`, entirely
through Lighthouse's transitive tree; uninstalling it returned the project to **0
vulnerabilities**. That tree would trip the repo's SCA gate. Separately, Lighthouse needs headless
Chrome and a running app to score a real page — it is a **CI-pipeline concern**, not a unit-suite
dependency. It belongs in CI infrastructure config (its own job, pinned/patched there), not in the
app's `package.json`. The performance half of US-31's acceptance (read p95 < 1s) rides with it and
is likewise deferred to that task.

**Why `vitest-axe` is the right layer to keep.** It installed clean (0 vulns), is
ESLint-version-independent, and delivers the highest-value check of the three: it asserts against
the DOM the user actually gets. The helper is deliberately self-contained — it uses only
vitest-axe's `axe` runner, not the library's custom matcher, because this version ships an **empty
`extend-expect` entry and no `exports` map** for the matcher subpath. It disables the
`color-contrast` rule, which jsdom cannot evaluate (no layout/paint) and which the separate
CVD/contrast audit against `tokens.css` owns.

## Consequences

**Positive:**
- Runtime a11y is now a merge-blocking check on four existing pages, at 0 vulns and no ESLint
  friction.
- A latent gap surfaced and was fixed: the `CreateShiftPage` test now wraps `SiteProvider`
  (matching `App.tsx`) — the form reads `useSelectedSite()` and could not render without it; the
  old loading-only test never exercised the loaded form.

**Carried forward (future implementation task):**
1. **`eslint-plugin-jsx-a11y`** — add once an ESLint-10-compatible release exists; wire into
   `eslint.config.js` flat config.
2. **`@lhci/cli` / Lighthouse a11y + perf budgets** — stand up as a CI-pipeline job (headless
   Chrome against a running build), not a devDependency; carries US-31's p95 acceptance.
3. **New-page axe coverage** — the four covered pages are the ones on `main`; the Tier-D dashboard
   pages (readiness/audit/insights) get axe coverage once their branches merge (cross-branch axe
   cannot be added before the merge).

## Alternatives rejected

1. **Force-install jsx-a11y with `--legacy-peer-deps`.** Rejected — an unsupported ESLint/plugin
   combination that CI's `npm ci` may reject, for a static layer whose value is the lowest of the
   three.
2. **Keep `@lhci/cli` and suppress the SCA findings.** Rejected — knowingly importing 7 high-sev
   transitive vulns into the repo to satisfy a check that belongs in CI infra anyway.
3. **Register vitest-axe's own `toHaveNoViolations` matcher.** Rejected for this version — its
   `extend-expect` entry is empty and it exposes no `exports` map for the matcher subpath, so a
   self-contained helper is more robust than fighting the package's broken subpath resolution.

---

## Related

- ADR-0017 (card & pill design language — CVD-safety; the contrast audit that owns `color-contrast`)
- SCRUM-420 (the `<output>`/`role=status` Sonar a11y work this overlaps)
- SCRUM-436 acceptance (WCAG 2.1 AA basics **met** by the axe layer; Lighthouse + p95 deferred)
