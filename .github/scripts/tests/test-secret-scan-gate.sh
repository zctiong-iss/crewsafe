#!/usr/bin/env bash
# Gate self-tests for .github/scripts/security/scan-secrets.sh (SCRUM-178, FR-014).
#
# Builds throwaway git repositories under mktemp -d, plants synthetic credentials
# generated at runtime, and asserts the real script's behaviour. Nothing
# secret-shaped is committed to this repository.
#
# Run locally:  .github/scripts/tests/test-secret-scan-gate.sh
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/harness.sh"

SCAN="$REPO_ROOT/.github/scripts/security/scan-secrets.sh"

printf 'test-secret-scan-gate\n'

require_executable "$SCAN" "scan-secrets.sh"

if ! command -v gitleaks >/dev/null 2>&1; then
  printf '  SKIP gitleaks not installed; behavioural cases need it.\n'
  printf '       Install with .github/scripts/security/install-scanners.sh\n'
  printf '       Running argument-validation and fail-closed cases only.\n\n'
  GITLEAKS_PRESENT=0
else
  GITLEAKS_PRESENT=1
fi

# --- argument validation (no gitleaks needed) -------------------------------

assert_exit 2 "--mode range without --base exits 2" \
  "$SCAN" --mode range

assert_exit 2 "unknown mode exits 2" \
  "$SCAN" --mode sideways

assert_exit 2 "unknown flag exits 2" \
  "$SCAN" --mode full --wat

# --- fail-closed: scanner missing (FR-012, SC-006) --------------------------
# An empty PATH removes gitleaks. The script must report an infrastructure
# failure, never a clean pass. A gate that exits 0 when it could not look is
# worse than no gate: it reports green.

# Run the gate with everything it needs EXCEPT gitleaks.
#
# Build a shim directory holding symlinks to the few tools the script uses, then
# run with PATH set to that directory alone. Filtering the caller's PATH was
# tried first and is not reliable -- a developer's PATH can contain malformed or
# generated entries. Blanking PATH entirely is worse: the interpreter itself
# stops resolving and the run exits 127, which looks like a fail-closed pass
# while actually testing nothing.
run_without_gitleaks() {
  local repo="$1" shim tool src
  shim="$(make_tmpdir)"
  for tool in bash env git jq mktemp rm cat; do
    src="$(command -v "$tool" 2>/dev/null)" || continue
    ln -s "$src" "$shim/$tool" 2>/dev/null || true
  done
  [[ -e "$shim/gitleaks" ]] && rm -f "$shim/gitleaks"
  ( cd "$repo" && PATH="$shim" "$SCAN" --mode full )
}

if [[ "$GITLEAKS_PRESENT" == 1 ]]; then
  repo_fc="$(new_repo)"
  assert_exit 2 "missing gitleaks exits 2, not 0 (fail closed)" \
    run_without_gitleaks "$repo_fc"
fi

# --- behavioural cases ------------------------------------------------------

if [[ "$GITLEAKS_PRESENT" == 1 ]]; then

  # Clean repository -> pass.
  repo_clean="$(new_repo)"
  assert_exit 0 "clean repo exits 0" \
    in_dir "$repo_clean" "$SCAN" --mode full

  # Planted credential at HEAD -> block, and name the file.
  repo_dirty="$(new_repo)"
  key="$(synthetic_aws_key)"
  commit_file "$repo_dirty" "config/app.properties" "aws_access_key_id = $key"

  out_dirty="$(cd "$repo_dirty" && "$SCAN" --mode full 2>&1)" && dirty_rc=0 || dirty_rc=$?
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$dirty_rc" == 1 ]]; then
    _pass "planted credential at HEAD exits 1"
  else
    _fail "planted credential at HEAD exits 1" "got exit $dirty_rc"
  fi
  assert_contains "$out_dirty" "config/app.properties" \
    "finding names the offending file"

  # Redaction (FR-010). The raw gitleaks report carries the credential in its
  # Secret/Match fields; verified against gitleaks 8.30.1. If the script ever
  # echoes the report wholesale, this is the test that catches it.
  assert_not_contains "$out_dirty" "$key" \
    "credential value never appears in output"

  findings_dirty="$(cd "$repo_dirty" && "$SCAN" --mode full --out /dev/stdout 2>/dev/null | tail -c 4000 || true)"
  assert_not_contains "$findings_dirty" "$key" \
    "credential value never appears in the normalized findings file"

  # US1 scenario 3 / SC-008: added then deleted in a later commit. Deleting a
  # secret from the tip does not remove it from history, so a tip-only scan
  # would pass here -- which is exactly the hole range mode must not have.
  repo_hist="$(new_repo)"
  base_sha="$(git -C "$repo_hist" rev-parse HEAD)"
  hist_key="$(synthetic_aws_key)"
  commit_file "$repo_hist" "leaked.env" "AWS_ACCESS_KEY_ID=$hist_key"
  remove_file "$repo_hist" "leaked.env"

  assert_exit 1 "credential deleted in a later commit still exits 1 (range mode)" \
    in_dir "$repo_hist" "$SCAN" --mode range --base "$base_sha"

  assert_exit 1 "credential deleted in a later commit still exits 1 (full mode)" \
    in_dir "$repo_hist" "$SCAN" --mode full

  # Unresolvable merge-base must fail closed rather than silently widening or
  # narrowing scope.
  repo_mb="$(new_repo)"
  assert_exit 2 "unresolvable merge-base exits 2" \
    in_dir "$repo_mb" "$SCAN" --mode range --base "0000000000000000000000000000000000000000"

fi

finish
