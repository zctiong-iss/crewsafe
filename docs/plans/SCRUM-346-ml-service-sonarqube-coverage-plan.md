# SCRUM-346 — ML-service SonarQube Coverage Reporting

## Decision

The repository-root `SAST (SonarQube)` job is the sole owner of ML-service coverage ingestion.
Before its scanner runs, it sets up Python 3.11, installs the existing hash-locked ML-service
dependencies, runs the ML-service pytest suite under Coverage.py, writes `ml-service/coverage.xml`, and
rejects a missing, empty, malformed, or source-path-invalid report.

`sonar-project.properties` consumes that report through the Python coverage setting, retains
`ml-service` as production source, and classifies `ml-service/test_*.py` as tests. Existing
backend JaCoCo and mobile LCOV inputs remain unchanged. The component-specific ML-service CI
workflow retains its separate build/smoke/container role; it does not upload runner-local
coverage to a second analysis.

## Safety and security controls

- The SAST workflow remains `contents: read` and its SAST job has no AWS credential action.
- ML-service dependencies remain installed with `--require-hashes`; Coverage.py is pinned and
  includes verified source, Linux CI, and local macOS wheel hashes.
- Tests use deterministic requests and a monkeypatched forecast failure; they do not use live
  AWS, weather, model, credentials, or personal data.
- The generated `.coverage` data file and XML report are ignored and never committed.
- Guard tests check the report contract, source/test classification, report-before-scan ordering,
  preservation of existing coverage inputs, and deliberate invalid-report/configuration cases.

## Local verification evidence

Completed on 2026-08-13:

- Linux CPython 3.11 `pip download --require-hashes` resolved all 33 declared ML-service
  packages successfully.
- The local Python 3.13 host cannot validate the committed full hash lock directly because a
  pre-existing `jiter` hash does not cover its macOS CPython 3.13 wheel. This does not affect the
  CI target: the target Linux CPython 3.11 lock passed. A temporary environment with the same
  pinned versions was used only to execute tests.
- ML-service pytest suite: 23 passed; Coverage.py wrote parseable XML with ML-service source paths.
- `test-ml-service-sonar-coverage.sh`: passed, including negative report and mutation cases.
- `test-sast-gate-config.sh`: 46 passed.

## Required PR evidence

Before merge, attach the pull-request `SAST (SonarQube)` result showing that the same revision's
`ml-service/coverage.xml` was consumed and that SonarQube displays non-zero ML-service coverage.
Do not include the Sonar token, generated report contents, or sensitive runtime data.
