# CrewSafe Terraform state backend (SCRUM-155)

This root provisions one isolated S3 backend per registered AWS account. It is
executed only by GitHub Actions; developers do not run Terraform locally and do
not select AWS profiles.

The account registry supplies `expected_account_id`, `account_alias`, and
`aws_region`. Terraform verifies the OIDC caller before changing the derived
bucket:

```text
crewsafe-terraform-state-<account-id>-ap-southeast-1
```

The bucket is versioned, uses SSE-S3 (`AES256`), enforces bucket-owner ownership,
blocks all public access, denies non-TLS requests, and has
`prevent_destroy = true`. These controls are created by `main.tf`; they are not
optional console settings.

The first bootstrap plan and apply use Terraform's default local backend only
inside ephemeral GitHub-hosted runners. After the apply creates the bucket, the
workflow preserves a recovery copy, generates the partial S3 backend
declaration and values, and migrates state to:

```text
key          = "crewsafe/bootstrap/terraform.tfstate"
encrypt      = true
use_lockfile = true
```

No DynamoDB lock table is used. Terraform's native S3 lockfile is stored next to
each state object. The registered remote roots currently use these independent
keys in the same selected account:

```text
crewsafe/cognito/shared-dev.tfstate
crewsafe/compute/shared-dev.tfstate
crewsafe/database/shared-dev.tfstate
crewsafe/ecr/shared-dev.tfstate
crewsafe/iam-policy-management/shared-dev.tfstate
crewsafe/network/shared-dev.tfstate
crewsafe/securityhub-import/shared-dev.tfstate
crewsafe/secrets/shared-dev.tfstate
```

The authoritative component catalogue is
[`.github/terraform/components.json`](../../../../.github/terraform/components.json).
Do not invent a state key or share state between account aliases.

Canonical copy-ready policies for the GitHub OIDC roles are in
[`iam/plan-role-policy.json`](iam/plan-role-policy.json) and
[`iam/apply-role-policy.json`](iam/apply-role-policy.json). They include all
bucket subresource reads performed when AWS provider `6.2.0` refreshes
`aws_s3_bucket`; omitting one can make an apply fail after creating the bucket.

See [the operator runbook](../../../../docs/runbooks/SCRUM-155-terraform-state-backend.md)
for account onboarding, IAM policies, plan/apply steps, verification, switching,
and recovery.
