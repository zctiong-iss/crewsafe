# SCRUM-155 Terraform state backend runbook

This runbook provisions CrewSafe Terraform state entirely through GitHub
Actions. Never run this root from a workstation, configure a local AWS profile,
or download a state or saved-plan artifact.

## 1. Onboard an AWS account

Sign in to the teammate's AWS Console and record its 12-digit account ID.
Confirm that the account has the intended credits and sufficient service
limits.

In **IAM → Identity providers**, create or reuse this OpenID Connect provider:

- Provider URL: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`

Create `CrewSafeGitHubTerraformPlanRole` and
`CrewSafeGitHubTerraformApplyRole`. Obtain the immutable GitHub owner and
repository IDs from an authenticated workstation:

```bash
gh api repos/zctiong-iss/crewsafe \
  --jq '"owner_id=\(.owner.id)\nrepo_id=\(.id)"'
```

Replace `<ACCOUNT_ID>`, `<OWNER_ID>`, and `<REPO_ID>` before using the trust
policy. Replace `<ACCOUNT_ID>` in the repository IAM policy templates before
attaching them to their roles.

Both roles use this trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:zctiong-iss@<OWNER_ID>/crewsafe@<REPO_ID>:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

Use the canonical
[plan role policy](../../infra/terraform/bootstrap/state/iam/plan-role-policy.json)
for `CrewSafeGitHubTerraformPlanRole`. Its only writes are short-lived native
S3 lockfiles needed to read remote state consistently; it cannot change
infrastructure or state.

Use the canonical
[apply role policy](../../infra/terraform/bootstrap/state/iam/apply-role-policy.json)
for `CrewSafeGitHubTerraformApplyRole`.

Both policies include the complete bucket-read set used when AWS provider
`6.2.0` refreshes `aws_s3_bucket`, including ACL, CORS, logging, website,
lifecycle, replication, acceleration, request-payment, and object-lock
configuration reads. These reads are required even when CrewSafe does not
configure those optional features. The apply policy adds only the bucket and
state-object writes needed by this root. Neither policy grants
`s3:DeleteBucket`.

Do not create an IAM user or long-lived AWS access key for GitHub. Expand the
apply role for later Terraform roots only through reviewed policy changes.

## 2. Register the account in GitHub

Open **Repository Settings → Secrets and variables → Actions → Variables**.
Create or edit `CREWSAFE_AWS_ACCOUNTS_JSON`:

```json
{
  "member-alias": {
    "account_id": "123456789012",
    "region": "ap-southeast-1",
    "plan_role_arn": "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformPlanRole",
    "apply_role_arn": "arn:aws:iam::123456789012:role/CrewSafeGitHubTerraformApplyRole"
  }
}
```

Aliases contain lowercase letters, digits, and hyphens. Validate the complete
JSON before saving. Never store AWS profiles, passwords, access keys, session
tokens, or credit details. No `TERRAFORM_APPLY_APPROVERS` variable is used.

## 3. Generate and review a plan

The SCRUM-155 implementation must first be merged into `main`, because the OIDC
trust policy rejects other refs.

For a new account, the plan and apply use local state only within their
ephemeral GitHub-hosted runners. The apply preserves a recovery object before
generating the S3 backend configuration and migrating state to the canonical
key. Developers still never run Terraform locally or download state.

1. Open **Actions → Terraform Plan → Run workflow**.
2. Select `main`, enter the registered alias, and select `state-backend`.
3. Confirm that the run assumes the intended plan role and account.
4. Review the alias, Region, derived bucket, mode, commit, checksum, and resource
   summary.
5. Confirm that the plan contains no DynamoDB, Cognito, IAM user, access key, or
   unrelated resource.
6. Record the successful workflow run ID and run attempt.
7. Stop if an existing bucket is not recognized as CrewSafe-managed.

The saved plan expires after one day. The artifact contains the binary plan and
non-secret metadata only; it never contains credentials or Terraform state.

## 4. Apply the reviewed plan

The plan actor or another authorized teammate performs the apply:

1. Open **Actions → Terraform Apply → Run workflow**.
2. Select `main`.
3. Enter the same account alias, component, operation, successful plan run ID,
   and plan run attempt.
4. Enter exactly `APPLY <account-alias> state-backend`.
5. Verify the account, commit, bucket, and checksum in the run.
6. Run the workflow.

The workflow rejects expired, altered, cross-account, non-main, or reused plans.
It applies the saved binary plan without replanning. The same actor may plan and
apply for fast solo operation in test accounts; no maintained approver list is
required.

## 5. Verify completion

The successful apply must prove:

- canonical state exists at `crewsafe/bootstrap/terraform.tfstate`;
- S3 versioning and AES256 encryption are enabled;
- ownership is `BucketOwnerEnforced`;
- all four public-access block controls are enabled;
- the bucket policy denies non-TLS access;
- remote state read/write and native `.tflock` operations work;
- the final Terraform plan reports no changes;
- no state, credential, or token is present in logs or artifacts;
- first-bootstrap recovery state was removed after verification.

Add the merged pull request, successful plan and apply links, and selected alias
to SCRUM-155. Keep SCRUM-154 blocked until the selected account passes all
checks.

## 6. Switch AWS accounts

Onboard and register the other account, then select its alias in both workflows.
Use that same alias for Cognito and subsequent Terraform roots. Each account
keeps its own backend and infrastructure; never share or migrate state between
teammates' accounts.

## 7. Failure and recovery

If bootstrap, migration, or verification fails:

1. Stop all applies for that alias and component.
2. Do not rerun automatically.
3. Determine whether authoritative state is at the canonical key or
   `crewsafe/bootstrap/recovery/<run-id>.tfstate`.
4. Preserve the recovery object until the failure is understood.
5. Do not use `terraform state push`, forced migration, or `force-unlock`
   without a reviewed recovery plan.
6. Record the failed workflow and findings in SCRUM-155.
7. Resume only after a teammate confirms the recovery procedure.

### Bucket created but Terraform state was not saved

If `aws_s3_bucket.terraform_state: Creating...` succeeded and a later provider
read failed, the bucket can exist even though the failed runner never saved or
migrated Terraform state. The original saved plan is stale and must not be
reused.

1. In the AWS Console, open the derived state bucket in the intended account.
2. Check **Objects** and enable **Show versions**. Confirm there is no canonical
   state, recovery state, lockfile, delete marker, or other object under
   `crewsafe/`.
3. If the bucket and every version are empty, use an authorized AWS
   administrator to delete only that exact orphaned bucket. The GitHub apply
   role intentionally cannot delete buckets.
4. Update both GitHub IAM roles from the canonical policy templates above.
5. Run **Terraform Plan** again from `main` and use its new run ID/attempt for a
   new apply. Never reuse the pre-failure plan.

If any canonical state, recovery state, version, delete marker, lockfile, or
unrecognized object exists, do not delete the bucket. Stop and prepare a
reviewed Terraform import or state-recovery procedure first.
