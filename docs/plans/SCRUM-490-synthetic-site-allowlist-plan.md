# SCRUM-490 — Synthetic-user site reconciliation is hard-coded to bishan/campus

## Starting state

`DemoDataSeeder` (`backend/src/main/java/com/crewsafe/identity/DemoDataSeeder.java`), a
`local`/`staging`-only `ApplicationRunner`, reconciled synthetic/developer user site membership
against `.github/cognito/synthetic-users.yml` with the site-code allowlist hard-coded in seven
independent places: two in `DemoDataSeeder.java` (the `bishan`/`campus` site map in `run()`, and
the positive allowlist in `parseAndValidateMappings`), three `jq` filters in
`.github/scripts/cognito/resolve-shared-config.sh` / `resolve-synthetic-users.sh`, and two
non-authoritative `enum` arrays in `.github/cognito/*.schema.json` docs. `reconcileMemberships`
treated that hard-coded pair as the *complete* desired state for every seeded user — deleting any
membership outside it on every backend restart, even one to a site the reconciler had never heard
of. The two problems compounded: no new site could be declared without a source change in three
different runtimes, and any membership to such a site was silently wiped on the next redeploy.

Surfaced while adding a second `SUPERVISOR` synthetic user (this session's other request); the
new user only needed the existing `bishan`/`campus` codes, but the underlying mechanism made any
future third site impossible to add safely.

## Approved design (via `/speckit-clarify`)

Two decisions came out of clarification before planning:

1. **One shared, versioned allowlist file** —
   [`backend/src/main/resources/cognito/known-site-codes.json`](../../backend/src/main/resources/cognito/known-site-codes.json),
   a flat JSON array of codes — read by both `DemoDataSeeder` (via `ClassPathResource` +
   Jackson) and the CI `jq` scripts (via a `KNOWN_SITE_CODES_FILE`-overridable path), replacing
   five load-bearing literals with one edit point. It lives under `backend/` rather than
   `.github/` specifically because both backend Docker builds (`backend-ci.yml`'s `build-test`
   and `publish-image` jobs) use `backend/` as their Docker build context — a file under
   `.github/` would never reach the built image without a build-context change, which was judged
   out of scope for this fix.
2. **Codes only, not full site definitions.** The CI side never consumes coordinates, only
   validates the code, so `DemoDataSeeder` keeps its own `SiteDefinition` map (display name +
   coordinates) for the sites it creates. That map's keys are validated to be a subset of the
   shared allowlist at startup (`validateSiteDefinitionsAreKnown`); a mismatch fails startup
   loudly rather than creating a site from incomplete data.

Consequence for anyone adding a genuinely new site: **two edits, not one** — an entry in
`known-site-codes.json` and a matching `SiteDefinition` entry in `DemoDataSeeder`, then a manifest
entry using it. Only reusing an *already-declared* code needs the manifest edit alone.

## `reconcileMemberships` fix (the data-loss half)

The obsolete-deletion filter narrowed from *"not in the manifest's desired sites"* to *"in the
reconciler's own managed scope (`siteByCode`) **and** not in the manifest's desired sites"*. A
membership to any site outside that managed scope — however it got there — is now left untouched
in both directions. This is the actual fix for the reported symptom; the allowlist work above is
what makes a third managed site possible to add at all.

## Non-authoritative doc drift (FR-008, found while scoping)

The two `.github/cognito/*.schema.json` files also embed a `site_codes` enum, but neither is
runtime-enforced (nothing runs `ajv`/`jsonschema` against a manifest; CI only checks they're valid
JSON). Regenerating them from the canonical file was judged more machinery than the problem
warranted for two doc-only artifacts, so `test-shared-config.sh` instead asserts both enums equal
`known-site-codes.json`'s contents — drift is caught, not structurally prevented, which is an
accepted, narrower guarantee than the Java/CI side gets.

## Verification

- `backend/src/test/java/com/crewsafe/identity/DemoDataSeederMappingTest.java`,
  `DemoDataSeederReconciliationTest.java`: allowlist genericity, `SiteDefinition`/allowlist subset
  validation, `resolveManagedSites` genericity, out-of-scope membership survival, mixed
  managed/unmanaged reconciliation, and the pre-existing SCRUM-432 default-policy regression all
  covered — see `backend/src/test/java/com/crewsafe/identity/` and run `./mvnw verify`.
- `.github/scripts/cognito/tests/test-shared-config.sh`,
  `test-synthetic-reconciliation-guards.sh`: CI-side allowlist genericity and schema-doc
  consistency.
- Full Spec Kit trail (spec, clarifications, plan, research, data model, tasks, analysis) was
  produced locally under Spec Kit and is not committed (gitignored `specs/`, per AGENTS.md); this
  document is the durable summary per AGENTS.md §6.3.
