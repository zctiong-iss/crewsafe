#!/usr/bin/env bash
# Shared test harness for the SCRUM-178 security gates.
#
# Provides throwaway git repositories, runtime-generated synthetic credentials,
# and assertion helpers. Sourced by the test scripts in this directory.
#
# Design rule (FR-014a): synthetic credentials are generated HERE, at runtime,
# inside a temporary directory. No secret-shaped fixture is ever committed to
# this repository. A committed fixture would need a gitleaks allowlist entry,
# and an allowlist broad enough to permit it could also mask a real leak.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
export REPO_ROOT

TESTS_RUN=0
TESTS_FAILED=0
_HARNESS_TMPDIRS=()

# --- output -----------------------------------------------------------------

_pass() {
  local label="$1"
  printf '  ok   %s\n' "$label"
}
_fail() {
  local label="$1" detail="${2:-}"
  printf '  FAIL %s\n' "$label"
  [[ $# -gt 1 ]] && printf '       %s\n' "$detail"
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

# --- temp dir lifecycle -----------------------------------------------------

# Every temp dir is registered and removed on exit, on success AND on failure.
# A test that plants credentials must not leave them on disk when it fails.
harness_cleanup() {
  local d
  for d in ${_HARNESS_TMPDIRS+"${_HARNESS_TMPDIRS[@]}"}; do
    [[ -n "$d" && -d "$d" ]] && rm -rf "$d"
  done
  _HARNESS_TMPDIRS=()
}
trap harness_cleanup EXIT INT TERM

make_tmpdir() {
  local d
  d="$(mktemp -d)"
  _HARNESS_TMPDIRS+=("$d")
  printf '%s' "$d"
}

# --- synthetic credentials --------------------------------------------------

# An AWS-access-key-shaped string, matching the gitleaks `aws-access-token`
# rule: AKIA followed by 16 uppercase alphanumerics.
#
# The body is randomised per call, deliberately. The obvious choice --
# AWS's documented example key AKIAIOSFODNN7EXAMPLE -- is NOT usable here:
# gitleaks allowlists it upstream, so a test built on it would assert that the
# gate rejects a value the gate is designed to ignore. Verified against
# gitleaks 8.30.1 on 2026-08-04: the example key yields zero findings, a
# randomised one yields an `aws-access-token` finding.
#
# The generated value authenticates against nothing and never leaves the
# throwaway repository it is written into.
# random_chars <count> <character class>
#
# Reads a BOUNDED slice of /dev/urandom, filters it, then truncates with
# parameter expansion. The obvious form -- `tr -dc CLASS </dev/urandom | head -c N`
# -- leaves tr reading an infinite stream after head exits, so tr takes SIGPIPE
# and prints "tr: write error: Broken pipe" to stderr on every call. That noise
# appeared in the Gate Self-Tests job output (SCRUM-178, 2026-08-06) and, under
# `set -o pipefail`, is a failure waiting to be depended on.
#
# 1024 bytes yields ~240 characters for a 62-of-256 class, comfortably more than
# any caller needs; the length check below makes a short draw loud rather than
# silently producing a too-short credential that the scanner would not match.
random_chars() {
  local count="$1" class="$2" raw
  raw="$(head -c 1024 /dev/urandom | LC_ALL=C tr -dc "$class")"
  if [[ ${#raw} -lt $count ]]; then
    printf 'harness: random_chars drew %d chars, needed %d\n' "${#raw}" "$count" >&2
    return 1
  fi
  printf '%s' "${raw:0:count}"
}

synthetic_aws_key() {
  # A Stripe TEST-MODE key shape: sk_test_ followed by 32 alphanumerics. Matches
  # the gitleaks `stripe-access-token` rule.
  #
  # Why not an AWS AKIA key, the obvious choice? Two shapes were measured
  # against gitleaks 8.30.1 on 2026-08-04:
  #
  #   AKIA + 16 random chars   -> 2 of 20 detected. The aws-access-token rule
  #                               gates on Shannon entropy, so detection depends
  #                               on which characters happen to be drawn. A test
  #                               fixture built on it flakes ~90% of the time.
  #   AWS's AKIAIOSFODNN7EXAMPLE -> 0 detected; allowlisted upstream.
  #   sk_test_ + 32 random     -> 12 of 12 detected, no entropy gate.
  #
  # `sk_test_` is Stripe's test-mode prefix: such keys are non-production by
  # construction, and this one is random, never transmitted, and lives only
  # inside a throwaway repository for the duration of one test.
  printf 'sk_test_%s' "$(random_chars 32 'a-zA-Z0-9')"
}

# A PEM private-key block. Also deterministic (12 of 12 against gitleaks 8.30.1),
# kept as a second credential shape so a test can assert on more than one rule.
synthetic_private_key() {
  printf -- '-----BEGIN RSA PRIVATE KEY-----\n%s\n-----END RSA PRIVATE KEY-----' \
    "$(random_chars 64 'A-Za-z0-9+/')"
}

# A generic high-entropy secret-shaped value, regenerated per call so no two
# test runs write the same string.
synthetic_generic_secret() {
  printf 'sk_test_%s' "$(random_chars 32 'a-zA-Z0-9')"
}

# --- throwaway git repositories ---------------------------------------------

# Create an initialised git repo with one benign commit. Echoes its path.
new_repo() {
  local dir
  dir="$(make_tmpdir)"
  git -C "$dir" init --quiet --initial-branch=main
  git -C "$dir" config user.email "test@example.invalid"
  git -C "$dir" config user.name "Gate Test"
  git -C "$dir" config commit.gpgsign false
  printf 'placeholder\n' >"$dir/README.md"
  git -C "$dir" add README.md
  git -C "$dir" commit --quiet -m "initial commit"
  printf '%s' "$dir"
}

# commit_file <repo> <relative path> <content> [message]
commit_file() {
  local repo="$1" path="$2" content="$3"
  local msg="${4:-add $path}"
  mkdir -p "$(dirname "$repo/$path")"
  printf '%s\n' "$content" >"$repo/$path"
  git -C "$repo" add "$path"
  git -C "$repo" commit --quiet -m "$msg"
}

# remove_file <repo> <relative path> -- deletes and commits, leaving the content
# reachable only through history. This is the US1-scenario-3 setup.
remove_file() {
  local repo="$1" path="$2"
  git -C "$repo" rm --quiet "$path"
  git -C "$repo" commit --quiet -m "remove $path"
}

# Run a command with a given working directory, in a subshell so the caller's
# cwd is untouched. `env -C` would be neater but is GNU-only; these tests must
# also run on a developer's macOS workstation.
in_dir() {
  local dir="$1"
  shift
  ( cd "$dir" && "$@" )
}

# --- assertions -------------------------------------------------------------

# assert_exit <expected> <label> <command...>
assert_exit() {
  local expected="$1" label="$2"
  shift 2
  TESTS_RUN=$((TESTS_RUN + 1))
  local actual=0
  "$@" >/dev/null 2>&1 || actual=$?
  if [[ "$actual" == "$expected" ]]; then
    _pass "$label"
  else
    _fail "$label" "expected exit $expected, got $actual"
  fi
}

# assert_contains <haystack> <needle> <label>
assert_contains() {
  local haystack="$1" needle="$2" label="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$haystack" == *"$needle"* ]]; then
    _pass "$label"
  else
    _fail "$label" "expected output to contain: $needle"
  fi
}

# assert_not_contains <haystack> <needle> <label>
#
# Deliberately does NOT echo the needle on failure: it is used to prove a secret
# never leaked, and printing it in the failure message would leak it.
assert_not_contains() {
  local haystack="$1" needle="$2" label="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$haystack" != *"$needle"* ]]; then
    _pass "$label"
  else
    _fail "$label" "output contained the value it must never contain (value withheld)"
  fi
}

# require_executable <path> <label>
#
# Hard-fails the whole run if the script under test is missing. Without this a
# missing script exits 1, which would make every `assert_exit 1` pass for
# entirely the wrong reason -- a green suite testing nothing at all.
require_executable() {
  local path="$1" label="$2"
  if [[ ! -f "$path" ]]; then
    printf '  FATAL %s not found at %s\n' "$label" "$path" >&2
    exit 1
  fi
  if [[ ! -x "$path" ]]; then
    printf '  FATAL %s is not executable: %s\n' "$label" "$path" >&2
    exit 1
  fi
}

# --- summary ----------------------------------------------------------------

finish() {
  printf '\n%d run, %d failed\n' "$TESTS_RUN" "$TESTS_FAILED"
  [[ "$TESTS_FAILED" -eq 0 ]] || exit 1
  exit 0
}
