#!/usr/bin/env bash
# Render normalized secret-scan findings onto the pull request (SCRUM-178,
# FR-008 / FR-009 / FR-010 / UX-002).
#
# Two surfaces, neither of which needs any token permission:
#   1. GitHub workflow commands on stdout -> inline annotations on the PR
#   2. Markdown appended to $GITHUB_STEP_SUMMARY -> readable from the checks tab
#
# Because workflow commands are interpreted from stdout by the runner, findings
# stay visible even on a fork pull request, where a PR-comment approach would
# need `pull-requests: write` and fail.
#
# Usage
#   report-findings.sh --in <path> --tool gitleaks --scope <text> --status <0|1|2>
#
# Exit code: ALWAYS 0. Reporting never decides pass/fail -- the scan script's
# status does, and the workflow re-raises it. A reporter that could fail would
# risk masking the very result it exists to display.
#
# SCOPE: the secret gate only. SonarQube Cloud provides its own pull-request
# decoration for SAST findings; re-rendering those here would duplicate its
# surface and put our formatting between the reviewer and the authoritative
# result.
set -euo pipefail

log() { printf '%s\n' "$*" >&2; }

die() {
  log "ERROR: $*"
  exit 0 # never fail the job from the reporter -- see header
}

in_file=""
tool=""
scope=""
status=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --in)
      in_file="${2:-}"
      shift 2
      ;;
    --tool)
      tool="${2:-}"
      shift 2
      ;;
    --scope)
      scope="${2:-}"
      shift 2
      ;;
    --status)
      status="${2:-}"
      shift 2
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ -n "$in_file" ]] || die "--in is required"
[[ -n "$tool" ]] || die "--tool is required"
[[ -n "$status" ]] || die "--status is required"
scope="${scope:-unknown scope}"

command -v jq >/dev/null 2>&1 || die "jq not found on PATH"

summary_out="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

# Neutralize untrusted content before it reaches a workflow command (SEC-002).
#
# File paths and rule messages come from repository content, which on a pull
# request is attacker-influenced. Left raw, a crafted value could emit its own
# workflow command -- most dangerously `::stop-commands::`, which suppresses
# every annotation after it and would let a hostile change hide real findings.
#
# Newlines and carriage returns are stripped (they end a workflow command), and
# ':' is replaced with a lookalike so no '::' sequence can survive.
sanitize() {
  printf '%s' "$1" | tr -d '\n\r' | sed 's/:/\xef\xb9\x95/g'
}

emit_annotations() {
  local count level file line rule msg i
  count="$(jq 'length' "$in_file" 2>/dev/null || echo 0)"
  for ((i = 0; i < count; i++)); do
    file="$(jq -r ".[$i].file // \"\"" "$in_file")"
    line="$(jq -r ".[$i].line // 1" "$in_file")"
    rule="$(jq -r ".[$i].rule_id // \"unknown\"" "$in_file")"
    msg="$(jq -r ".[$i].message // \"\"" "$in_file")"
    # Note: `.blocking // true` would be WRONG here. jq's `//` treats `false`
    # as empty, so an explicitly non-blocking finding would come back `true` and
    # be rendered as a blocking ::error. Compare explicitly instead.
    if [[ "$(jq -r ".[$i].blocking == false" "$in_file")" == "true" ]]; then
      level="warning"
    else
      level="error"
    fi
    # Only rule metadata is emitted -- never matched content, which for a
    # credential rule would be the credential itself (FR-010).
    printf '::%s file=%s,line=%s,title=%s::%s\n' \
      "$level" "$(sanitize "$file")" "${line//[^0-9]/}" \
      "$(sanitize "${tool}:${rule}")" "$(sanitize "$msg")"
  done
}

write_summary() {
  local count blocking
  count="$(jq 'length' "$in_file" 2>/dev/null || echo 0)"
  blocking="$(jq '[.[] | select(.blocking != false)] | length' "$in_file" 2>/dev/null || echo 0)"

  {
    printf '## Secret scan\n\n'
    printf '**Scope scanned:** %s\n\n' "$scope"

    case "$status" in
      0)
        printf 'The gate **ran** over the scope above and found **%s blocking finding(s)**.\n\n' "$blocking"
        printf 'This is a completed scan, not a skipped one.\n\n'
        ;;
      1)
        printf 'The gate **ran** and found **%s blocking finding(s)**. This blocks the merge.\n\n' "$blocking"
        printf 'A finding is a signal to **rotate the credential at its source**. Removing it\n'
        printf 'from git does not make an exposed credential safe.\n\n'
        ;;
      *)
        printf 'The gate **failed to run**: this is an **infrastructure** failure, not a code finding.\n\n'
        printf 'Re-running the job on the same commit is the first response. The check fails\n'
        printf 'closed by design -- a green check must never mean "the scanner did not run".\n\n'
        ;;
    esac

    if [[ "$count" -gt 0 ]]; then
      printf '| Rule | File | Line | Severity | Blocking |\n'
      printf '| --- | --- | --- | --- | --- |\n'
      # Sanitize here too. The summary is untrusted content rendered as markdown:
      # a raw newline would break out of the table row, and a raw '::' sequence
      # would be a workflow command if the summary is ever echoed to stdout.
      # Pipes are escaped so a crafted path cannot forge extra table columns.
      local i file rule sev blk line
      for ((i = 0; i < count; i++)); do
        file="$(sanitize "$(jq -r ".[$i].file // \"\"" "$in_file")")"
        rule="$(sanitize "$(jq -r ".[$i].rule_id // \"unknown\"" "$in_file")")"
        sev="$(sanitize "$(jq -r ".[$i].severity // \"\"" "$in_file")")"
        line="$(jq -r ".[$i].line // 1" "$in_file")"
        if [[ "$(jq -r ".[$i].blocking == false" "$in_file")" == "true" ]]; then
          blk="no"
        else
          blk="**yes**"
        fi
        printf '| %s | %s | %s | %s | %s |\n' \
          "${rule//|/\\|}" "${file//|/\\|}" "${line//[^0-9]/}" "${sev//|/\\|}" "$blk"
      done
      printf '\n'
    fi
  } >>"$summary_out"

  # Also emit a concise, sanitized plaintext summary to stdout so callers
  # that capture stdout (for example the gate self-tests) see the same
  # high-level information even when $GITHUB_STEP_SUMMARY points at a
  # runner-managed file. Sanitize to avoid introducing workflow commands.
  local short_scope
  short_scope="$(sanitize "$scope")"
  case "$status" in
    0)
      printf 'The gate ran and found %s blocking finding(s) in scope: %s\n' "$blocking" "$short_scope"
      ;;
    1)
      printf 'The gate ran and found %s blocking finding(s) in scope: %s\n' "$blocking" "$short_scope"
      ;;
    *)
      printf 'The gate failed to run (infrastructure failure) for scope: %s\n' "$short_scope"
      ;;
  esac
}

if [[ ! -f "$in_file" ]]; then
  # No findings file usually means the scan died before producing one. Say so
  # rather than rendering a misleading clean result.
  {
    printf '## Secret scan\n\n'
    printf '**Scope scanned:** %s\n\n' "$scope"
    printf 'No findings file was produced. Treat this as an **infrastructure** failure.\n\n'
  } >>"$summary_out"
  exit 0
fi

emit_annotations
write_summary
exit 0
