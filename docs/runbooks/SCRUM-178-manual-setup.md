# SCRUM-178 — one-time manual setup

Four steps that code cannot perform. Until step 3 is done **the gates run but block
nothing**, and SCRUM-178 is not Done.

Do them in order. Steps 1 and 2 must be finished before the delivering pull request can go
green, because the `SAST (SonarQube)` check fails closed without a token and a project to
report into.

Day-to-day operation is in [the main runbook](./SCRUM-178-sast-and-secret-scanning.md).
Why SonarQube Cloud at all is in [ADR 0010](../adr/0010-sonarqube-cloud-for-sast.md).

**Who can do this**: the repository owner (`zctiong-iss`). Steps 1–2 need a SonarQube Cloud
account; step 3 needs GitHub admin on the repository.

---

## Step 1 — SonarQube Cloud organization, project, and token

### 1.1 Sign in and create the organization

1. Go to <https://sonarcloud.io> and **Log in with GitHub**. Authorise it when prompted.
2. Create an organization, choosing the **import from GitHub** option rather than creating
   one manually — that binds the organization to your GitHub account and installs the
   SonarQube Cloud GitHub App, which is what posts pull-request decoration later.
3. When GitHub asks which repositories the app may access, grant it **`zctiong-iss/crewsafe`**
   (selecting only this repository is fine and preferable to "all repositories").
4. Choose the **Free plan** when asked. This covers private projects up to 50,000 lines of
   code; the repository is currently at roughly 8,700 lines of Java, about 17%.

> The organization key SonarQube derives from your GitHub account must match
> `sonar.organization` in `sonar-project.properties`, currently **`zctiong-iss`**. If
> SonarQube gives you a different key, change the file rather than fighting the UI.

### 1.2 Create the project

1. **Analyze new project** → pick `zctiong-iss/crewsafe`.
2. Confirm the **project key**. It must match `sonar.projectKey` in
   `sonar-project.properties`, currently **`zctiong-iss_crewsafe`**. If SonarQube proposes
   a different key, either accept theirs and update the file, or set it to ours — but the
   two must agree exactly or analysis silently lands in the wrong project.
3. The display name will be **`Crewsafe`** (from `sonar.projectName`).

### 1.3 Choose CI-based analysis, not Automatic Analysis

This is the step most likely to be missed and it will break the gate if it is.

SonarQube Cloud offers **Automatic Analysis**, which scans the repository itself on its own
schedule. Our design runs analysis from CI so the result is bound to a specific commit and
so `sonar.qualitygate.wait` can block the merge.

- Set the analysis method to **GitHub Actions** (i.e. CI-based).
- **Turn Automatic Analysis off** if it is enabled — under the project's
  *Administration → Analysis Method*. The two conflict: with Automatic Analysis on, CI
  analysis is rejected and the `SAST (SonarQube)` job fails.

### 1.4 Generate the token and add it to GitHub

1. In SonarQube Cloud, generate an analysis token for this project
   (*My Account → Security*, or the token step of the project onboarding wizard).
2. **Copy it immediately** — it is shown once.
3. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `SONAR_TOKEN` (exactly this — the workflow reads that name)
   - Value: the token
4. Do **not** commit the token anywhere. If you ever paste it into a file, the secret gate
   in this very change will catch it — but rotate it anyway, because detection is not
   containment.

### 1.5 Verify

Trigger the workflow (**Actions → Security Scan → Run workflow**, or push a commit) and
confirm the `SAST (SonarQube)` job gets past the *Verify analysis credential* step. If it
fails there, `SONAR_TOKEN` is missing or misnamed.

---

## Step 2 — Custom Quality Gate (security conditions only)

> **Blocked on the free plan — read this before doing anything in the UI.**
>
> Discovered 2026-08-04: the project's Quality Gate page states *"Your current plan does
> not allow you to associate a quality gate other than Sonar way (Default) to this
> project."* Custom Quality Gates require a paid plan. This was not caught during design —
> see [ADR 0010, 2026-08-04 addendum](../adr/0010-sonarqube-cloud-for-sast.md) for the full
> account.
>
> **Decision**: run on the default "Sonar way" gate for now, and hold off on Step 3
> (required checks) until a custom gate is available. Do not add JaCoCo or otherwise chase
> a passing coverage condition to work around this — that is scope creep beyond SCRUM-178,
> and the resolution below removes the need for it. **2.1–2.4 below are what to do once the
> trial (or a subscription) is active; do not attempt them on the free plan.**
>
> **SCRUM-250 update**: once the trial (or subscription) is active, Steps 2.1–2.3 below no
> longer need to be done by hand in the SonarQube Cloud UI. Run
> `.github/scripts/security/configure-sonar-gate.sh --dry-run` to preview the change, then
> without the flag to apply it — see
> [`specs/019-sonar-quality-gate-automation/quickstart.md`](../../specs/019-sonar-quality-gate-automation/quickstart.md).
> It creates/converges the gate and its three conditions and assigns it to the project. The
> manual steps below remain the documented fallback and are still how to do 2.0.2's trial
> activation itself, which the script does not and cannot perform.

### 2.0 Why "Sonar way" is a real problem here, not just an inconvenience

"Sonar way" gates New Code on coverage (≥ 80%), duplicated lines (≤ 3%), and a
maintainability rating, in addition to security and reliability. `backend/pom.xml` has no
JaCoCo plugin, and with 28 test files against 82 main classes, coverage would not clear 80%
even if wired up today. **The coverage condition would fail on effectively every
substantive pull request** — blocking merges for a reason that has nothing to do with
security, which is exactly what a security-only gate exists to avoid.

There is a UI toggle, *"ignore duplication and coverage on small changes,"* which exempts
changesets under 20 new lines. It does not help most real pull requests, and does nothing
for the maintainability-rating condition.

### 2.0.1 Interim state (current)

`sonar.qualitygate.wait=true` is already wired up against whatever gate is assigned, so
`SAST (SonarQube)` will report Sonar way's true result today — likely failing on coverage
for any substantive change. **This is expected and does not block anyone**, because Step 3
has not been done: no check is required on `main` yet.

### 2.0.2 Start the trial, then do 2.1–2.4

1. Start the 14-day SonarQube Cloud trial (Upgrade → Start trial, from the project or
   organization page).
2. Confirm the Quality Gate page no longer shows the "current plan does not allow" banner.
3. Proceed with 2.1–2.4 below.

**Per FR-019**: once the trial is active, a custom gate may be created and used, but it
must not become the *permanent* basis for a required check without a deliberate follow-up
decision before the trial lapses. If the trial ends before a subscription decision is made,
the project reverts to Sonar way and the 2.0/2.0.1 constraints apply again — do not let
that happen silently after Step 3 has already made the check required.

### 2.1 Create the gate

1. SonarQube Cloud → **Quality Gates** → **Create**.
2. Name it something unambiguous, e.g. **`CrewSafe Security Gate`**.

### 2.2 Add conditions — all on **New Code**

| Metric | Operator | Value |
|---|---|---|
| Security issues with severity Blocker or High | is greater than | `0` |
| Security Hotspots Reviewed | is less than | `100%` |
| Reliability issues with severity Blocker or High | is greater than | `0` |

Exact metric labels vary a little with the SonarQube release. The intent is what matters:
**fail when new code introduces a Blocker or High severity issue, or leaves a security
hotspot unreviewed.** `Medium`, `Low`, and `Info` must not block — they are reported for
awareness.

**Add no coverage condition. Add no duplication condition.** If you later add JaCoCo and
want coverage gating, add the plugin first, confirm reports are produced, then add the
condition — and update the assertion in
`.github/scripts/tests/test-sast-gate-config.sh` that currently guards against exactly this
misconfiguration.

### 2.3 Assign it and set the New Code definition

1. On the gate, use **Projects** to attach it to `Crewsafe`, or set it as the organization
   default.
2. Check the project's **New Code** definition (*Administration → New Code*). "Previous
   version" or "Number of days" both work. This defines what "new" means to every condition
   above, so an unexpected setting here changes what the gate blocks on.

### 2.4 Verify

Confirm the project's overview shows **`CrewSafe Security Gate`** as its Quality Gate, not
"Sonar way".

---

## Step 3 — Make the checks required on `main`

> **Deliberately deferred — do not do this step yet.**
>
> Decided 2026-08-04: required checks stay off until Step 2 is actually complete with a
> custom gate (i.e. after the trial starts and the security-only gate is created and
> assigned). Turning this on while the project runs on Sonar way would make coverage —
> not security — the thing blocking every merge. See the note at the top of Step 2.
>
> **SCRUM-250 update**: once Step 2 is actually complete, this step is also scriptable —
> the same `.github/scripts/security/configure-sonar-gate.sh` run adds `Secret Scan`,
> `SAST (SonarQube)`, and `Gate Self-Tests` to `main`'s required status checks via a
> targeted GitHub API PATCH (not the full-object `PUT` §3.2 below warns against), so
> Section 3.1's manual UI steps are no longer the only way to do this. §3.2's verification
> command still applies either way.

**This is the step that makes the gates actually block.** Right now `main` has branch
protection with an approval requirement but **zero required status checks** — the gates run
and are advisory. That is intentional for now, not an oversight to fix immediately.

GitHub only offers a check as "required" **after it has reported at least once**, so this
must follow a run of the workflow on this branch or on `main`.

### 3.1 Add the checks

**Settings → Branches → the `main` rule → Edit**

1. Tick **Require status checks to pass before merging**.
2. Tick **Require branches to be up to date before merging** (already on — `strict: true`).
3. In the search box add all three, by their exact check names:
   - `Secret Scan`
   - `SAST (SonarQube)`
   - `Gate Self-Tests`
4. Save.

Leave the existing settings alone: 1 required approving review, require code owner reviews,
no force pushes, no deletions.

### 3.2 Verify

```sh
gh api repos/zctiong-iss/crewsafe/branches/main/protection \
  --jq '.required_status_checks.contexts'
```

Expected:

```json
["Secret Scan", "SAST (SonarQube)", "Gate Self-Tests"]
```

Before this step it returns `[]`, which is the current state.

> Use the UI rather than the API for this. Setting protection through
> `gh api --method PUT` replaces the **entire** protection object, so a partial payload
> silently drops the review requirements that are already in place.

---

## Step 4 — Prove a real finding blocks a pull request

Why this step exists: the automated SAST test is a **configuration lint**, not a
behavioural test. Sonar's analyser sits behind an authenticated SaaS and cannot be run
hermetically, so nothing in CI proves that a genuine finding blocks a merge. This step
proves it once, by hand, and the evidence goes on the pull request.

### 4.1 Create a scratch branch with a deliberate flaw

```sh
git checkout -b scratch/scrum-178-sast-evidence
```

Introduce one clearly insecure pattern in a Java file under `backend/src/main` — something
Sonar rates Blocker or High. Reliable choices: a hardcoded credential passed to an
authentication call, disabled TLS certificate validation, or string-concatenated SQL in a
query.

Keep it to a single obviously-wrong file. This branch is never merged.

### 4.2 Open a pull request and capture the evidence

```sh
git push -u origin scratch/scrum-178-sast-evidence
gh pr create --title "SCRATCH: SAST gate evidence (do not merge)" \
             --body "Deliberate High-severity finding to demonstrate the SAST gate. Not for merge."
```

Confirm and screenshot:

1. `SAST (SonarQube)` is **failing**.
2. SonarQube's pull-request decoration appears — a summary comment plus an inline comment
   on the offending line.
3. The finding's severity is `Blocker` or `High`.

### 4.3 Confirm the secret gate too, while you are here

Add a fake-looking credential to the same scratch branch, push, and confirm `Secret Scan`
fails with an annotation naming the file and line — and that **the credential value itself
does not appear** in the annotation, the summary, or the log.

Use an obviously synthetic value. It authenticates against nothing, and the branch is
deleted, but treat it as a real leak anyway if you accidentally use something genuine.

### 4.4 Clean up — do not skip this

```sh
gh pr close --delete-branch
```

The scratch branch must never be merged. Attach the screenshots to the SCRUM-178 pull
request as reviewer evidence, then delete the branch.

---

## Done checklist

- [x] SonarQube Cloud organization created and bound to GitHub
- [x] Project `Crewsafe` created; key matches `sonar.projectKey`
- [ ] Automatic Analysis **off**, CI-based analysis selected
- [ ] `SONAR_TOKEN` present in repository secrets — **confirm**, not assumed here (secret
      values and presence aren't verifiable from outside GitHub's UI/API by this agent)
- [ ] **Deferred** — 14-day trial started (unlocks custom Quality Gates on the free plan)
- [ ] **Deferred** — Custom Quality Gate created, security conditions only, **no coverage
      condition** (blocked on the free plan today; see Step 2.0)
- [ ] **Deferred** — Quality Gate assigned to the project; New Code definition checked
- [ ] **Deliberately not done yet** — `Secret Scan`, `SAST (SonarQube)`, `Gate Self-Tests`
      marked required on `main` (see Step 3 note — do this only after the custom gate is live)
- [ ] `required_status_checks.contexts` verified non-empty via the API
- [ ] Scratch pull request demonstrated a blocking `High` finding; screenshots attached
- [ ] Scratch branch closed and deleted

Only when every box is ticked does SCRUM-178 satisfy FR-011 and its Definition of Done. As
of 2026-08-04, this is intentionally incomplete: the project runs on SonarQube's default
"Sonar way" gate, and required checks remain off on `main` until the custom gate replaces
it. Nothing merges based on `SAST (SonarQube)`'s result today.
