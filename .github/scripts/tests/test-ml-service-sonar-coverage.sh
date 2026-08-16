#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/security-scan.yml"
SONAR_PROPS="$ROOT/sonar-project.properties"
TESTS_RUN=0
TESTS_FAILED=0
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

pass() { local label="$1"; printf '  ok   %s\n' "$label"; }
fail() { local label="$1"; printf '  FAIL %s\n' "$label"; TESTS_FAILED=$((TESTS_FAILED + 1)); }

check() {
  local label="$1"
  shift
  TESTS_RUN=$((TESTS_RUN + 1))
  if "$@"; then pass "$label"; else fail "$label"; fi
}

contains() { local file="$1" needle="$2"; grep -q -F -- "$needle" "$file"; }

sast_block() {
  local workflow="${1:-$WORKFLOW}"
  awk '/^  sast:/{inside=1} /^  [a-z-]+:/{if ($0 !~ /^  sast:/) inside=0} inside' "$workflow"
}

ordered() {
  local content="$1"
  shift
  local previous=0 current needle
  for needle in "$@"; do
    current="$(awk -v needle="$needle" 'index($0, needle) { print NR; exit }' <<<"$content")"
    [[ -n "$current" && "$current" -gt "$previous" ]] || return 1
    previous="$current"
  done
}

validate_report() {
  local report="$1"
  [[ -s "$report" ]] || return 1
  python3 - "$ROOT" "$report" <<'PY'
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

repo = Path(sys.argv[1]).resolve()
report = Path(sys.argv[2])
root = ET.parse(report).getroot()
sources = [Path(node.text) for node in root.findall('.//sources/source') if node.text]
if not sources:
    raise SystemExit('coverage XML has no source roots')

classes = root.findall('.//class')
if not classes:
    raise SystemExit('coverage XML has no classes')

service_root = (repo / 'ml-service').resolve()
for node in classes:
    filename = node.get('filename')
    if not filename:
        raise SystemExit('coverage XML class has no filename')
    candidates = [Path(filename)] if Path(filename).is_absolute() else [source / filename for source in sources]
    for candidate in candidates:
        try:
            candidate.resolve().relative_to(service_root)
        except ValueError:
            continue
        if candidate.is_file():
            break
    else:
        raise SystemExit(f'coverage XML source is not a checked-out ML-service file: {filename}')
PY
}

reject_report() {
  local report="$1"
  ! validate_report "$report" >/dev/null 2>&1
}

has_read_only_permission() {
  grep -A1 '^permissions:' "$WORKFLOW" | grep -q '^  contents: read$'
}

sast_has_no_aws_credential_action() {
  local sast="$1"
  ! grep -q 'configure-aws-credentials' <<<"$sast"
}

workflow_contract_holds() {
  local workflow="$1"
  local sast
  sast="$(sast_block "$workflow")"
  grep -A1 '^permissions:' "$workflow" | grep -q '^  contents: read$' || return 1
  sast_has_no_aws_credential_action "$sast" || return 1
  contains "$workflow" 'python -m pip install --require-hashes -r requirements.txt' || return 1
  contains "$workflow" 'python -m coverage run -m pytest test_forecast.py' || return 1
  contains "$workflow" 'python -m coverage xml -o coverage.xml' || return 1
  ordered "$sast" \
    'Install ML-service dependencies for coverage' \
    'Generate ML-service coverage' \
    'Validate ML-service coverage report' \
    'Analyse with SonarQube Cloud'
}

sonar_contract_holds() {
  local properties="$1"
  grep -q '^sonar\.python\.coverage\.reportPaths=ml-service/coverage\.xml$' "$properties" || return 1
  grep -q '^sonar\.sources=.*ml-service' "$properties" || return 1
  grep -q '^sonar\.tests=.*ml-service' "$properties" || return 1
  grep -q '^sonar\.test\.inclusions=.*ml-service/test_\*\.py' "$properties" || return 1
  grep -q '^sonar\.coverage\.jacoco\.xmlReportPaths=backend/target/site/jacoco/jacoco\.xml$' "$properties" || return 1
  grep -q '^sonar\.javascript\.lcov\.reportPaths=.*mobile/coverage/sonar-lcov\.info' "$properties"
}

reject_workflow_contract() {
  local workflow="$1"
  ! workflow_contract_holds "$workflow"
}

reject_sonar_contract() {
  local properties="$1"
  ! sonar_contract_holds "$properties"
}

valid_report="$TMP_DIR/valid.xml"
cat >"$valid_report" <<'XML'
<?xml version="1.0" ?>
<coverage>
  <sources><source>ml-service</source></sources>
  <packages><package><classes><class filename="app.py" /></classes></package></packages>
</coverage>
XML
empty_report="$TMP_DIR/empty.xml"
: >"$empty_report"
malformed_report="$TMP_DIR/malformed.xml"
printf '<coverage><sources>' >"$malformed_report"
invalid_source_report="$TMP_DIR/invalid-source.xml"
cat >"$invalid_source_report" <<'XML'
<coverage>
  <sources><source>ml-service</source></sources>
  <packages><package><classes><class filename="not-in-service.py" /></classes></package></packages>
</coverage>
XML

printf 'test-ml-service-sonar-coverage\n'
check 'valid synthetic coverage report is accepted' validate_report "$valid_report"
check 'empty coverage report is rejected' reject_report "$empty_report"
check 'malformed coverage report is rejected' reject_report "$malformed_report"
check 'invalid source reference is rejected' reject_report "$invalid_source_report"

check 'security scan workflow exists' test -f "$WORKFLOW"
check 'SonarQube properties exist' test -f "$SONAR_PROPS"

if [[ -f "$WORKFLOW" ]]; then
  sast="$(sast_block)"
  check 'SAST keeps read-only repository permission' has_read_only_permission
  check 'SAST has no AWS credential action' sast_has_no_aws_credential_action "$sast"
  check 'SAST installs ML-service dependencies with hashes' contains "$WORKFLOW" 'python -m pip install --require-hashes -r requirements.txt'
  check 'SAST runs deterministic ML-service endpoint tests under coverage' contains "$WORKFLOW" 'python -m coverage run -m pytest test_forecast.py'
  check 'SAST writes the declared coverage report' contains "$WORKFLOW" 'python -m coverage xml -o coverage.xml'
  check 'SAST validates coverage before SonarQube scan' ordered "$sast" \
    'Install ML-service dependencies for coverage' \
    'Generate ML-service coverage' \
    'Validate ML-service coverage report' \
    'Analyse with SonarQube Cloud'
fi

if [[ -f "$SONAR_PROPS" ]]; then
  check 'Python coverage report path is declared' grep -q '^sonar\.python\.coverage\.reportPaths=ml-service/coverage\.xml$' "$SONAR_PROPS"
  check 'ML-service remains a production source' grep -q '^sonar\.sources=.*ml-service' "$SONAR_PROPS"
  check 'ML-service is a Sonar test root' grep -q '^sonar\.tests=.*ml-service' "$SONAR_PROPS"
  check 'ML-service test naming is classified as test code' grep -q '^sonar\.test\.inclusions=.*ml-service/test_\*\.py' "$SONAR_PROPS"
  check 'backend JaCoCo report remains configured' grep -q '^sonar\.coverage\.jacoco\.xmlReportPaths=backend/target/site/jacoco/jacoco\.xml$' "$SONAR_PROPS"
  check 'mobile LCOV report remains configured' grep -q '^sonar\.javascript\.lcov\.reportPaths=.*mobile/coverage/sonar-lcov\.info' "$SONAR_PROPS"
fi

check 'complete workflow coverage contract holds' workflow_contract_holds "$WORKFLOW"
check 'complete SonarQube coverage contract holds' sonar_contract_holds "$SONAR_PROPS"

mutated_workflow="$TMP_DIR/security-scan-without-validation.yml"
sed 's/name: Validate ML-service coverage report/name: Coverage report step removed/' "$WORKFLOW" >"$mutated_workflow"
check 'workflow contract rejects missing report-validation step' reject_workflow_contract "$mutated_workflow"

mutated_properties="$TMP_DIR/sonar-without-python-test-classification.properties"
sed 's|ml-service/test_\*\.py|ml-service/tests/**|' "$SONAR_PROPS" >"$mutated_properties"
check 'SonarQube contract rejects test-classification drift' reject_sonar_contract "$mutated_properties"

printf '%d tests, %d failed\n' "$TESTS_RUN" "$TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]
