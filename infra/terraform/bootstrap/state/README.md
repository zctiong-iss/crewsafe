# CrewSafe Terraform state backend

This root provisions one isolated S3 backend per registered AWS account. It is
executed only by GitHub Actions; developers do not run Terraform locally and do
not select AWS profiles.

The account registry supplies `expected_account_id`, `account_alias`, and
`aws_region`. Terraform verifies the OIDC caller before changing the derived
bucket:

```text
crewsafe-terraform-state-<account-id>-ap-southeast-1
```

The partial S3 backend is configured ephemerally by the workflows with:

```text
key          = "crewsafe/bootstrap/terraform.tfstate"
encrypt      = true
use_lockfile = true
```

No DynamoDB lock table is used. Future roots use independent keys in the same
selected account:

```text
crewsafe/cognito/test.tfstate
crewsafe/cognito/staging.tfstate
crewsafe/<component>/<environment>.tfstate
```

See [the operator runbook](../../../../docs/runbooks/SCRUM-155-terraform-state-backend.md)
for account onboarding, IAM policies, plan/apply steps, verification, switching,
and recovery.
