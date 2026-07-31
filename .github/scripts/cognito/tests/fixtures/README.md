# Synthetic fixtures

All identities in this directory are synthetic. Fixtures must never contain a
real person's email address, password, token, AWS key, client secret, or
credential copied from an account.

Synthetic login identifiers use the reserved
`@synthetic.crewsafe.invalid` namespace. Cognito subjects use obvious UUID test
values. Tests must assert that credential values never appear in stdout,
stderr, workflow summaries, or artifacts.

AWS command fixtures are deterministic shell stubs. A stub records only command
names and non-secret identifiers. Password arguments are recorded as
`[REDACTED]`, and tests fail if a raw password-shaped value appears.

Temporary manifests belong in a `mktemp -d` directory and are removed by a
trap. Tests must not call AWS, obtain OIDC credentials, or run Terraform.
