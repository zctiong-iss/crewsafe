#!/usr/bin/env bash
set -euo pipefail
service="${1:-}"
action="${2:-}"
shift 2
printf '%s %s' "$service" "$action" >>"$AWS_STUB_LOG"
redact=false
for argument in "$@"; do
  if [[ "$redact" == true ]]; then
    printf ' [REDACTED]' >>"$AWS_STUB_LOG"
    redact=false
  elif [[ "$argument" == --secret-string || "$argument" == --password ]]; then
    printf ' %s' "$argument" >>"$AWS_STUB_LOG"
    redact=true
  else
    printf ' %s' "$argument" >>"$AWS_STUB_LOG"
  fi
done
printf '\n' >>"$AWS_STUB_LOG"

if [[ "${AWS_STUB_FAIL_ACTION:-}" == "$service/$action" ]]; then
  printf 'DependencyUnavailable\n' >&2
  exit 42
fi

case "$service/$action" in
  sts/get-caller-identity) printf '123456789012\n' ;;
  cognito-idp/admin-get-user)
    printf '{"Username":"synthetic-worker","Enabled":%s,"UserStatus":"CONFIRMED","UserAttributes":[{"Name":"email","Value":"synthetic-worker@synthetic.crewsafe.invalid"},{"Name":"sub","Value":"00000000-0000-0000-0000-000000000001"}]}\n' \
      "${AWS_STUB_ENABLED:-true}"
    ;;
  cognito-idp/admin-list-groups-for-user)
    printf '{"Groups":[{"GroupName":"synthetic-test-users"}]}\n'
    ;;
  cognito-idp/list-users)
    printf '{"Users":[{"Username":"synthetic-worker","Attributes":[{"Name":"email","Value":"synthetic-worker@synthetic.crewsafe.invalid"},{"Name":"sub","Value":"00000000-0000-0000-0000-000000000001"}]}]}\n'
    ;;
  secretsmanager/get-random-password) printf 'Generated-%s-Aa1!\n' "$RANDOM" ;;
  *) printf '{}\n' ;;
esac
