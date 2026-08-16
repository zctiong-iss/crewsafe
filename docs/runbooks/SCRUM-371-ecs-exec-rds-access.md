# SCRUM-371 ECS Exec Access to Shared-Dev RDS Runbook

**Components changed**: `secrets-shared-dev` (`infra/terraform/secrets`), `compute-shared-dev`
(`infra/terraform/compute`), `iam-policy-management-shared-dev`
(`infra/terraform/iam-policy-management`) · No new component, no new Terraform state

**Plan**: [SCRUM-371-ecs-exec-rds-access-plan.md](../plans/SCRUM-371-ecs-exec-rds-access-plan.md)

This runbook covers what this feature grants, how to discover the running backend task, open an
SSM port-forward tunnel through it to the shared-dev RDS instance, retrieve the RDS-managed
credential, and connect — plus the three real failures live testing hit and how to recognize them
if they recur.

> **Never run Terraform against a real account from a workstation** (`AGENTS.md` §3). Everything
> that touches AWS state here is a CI dispatch. The commands below are ordinary AWS CLI calls
> against already-applied infrastructure — not Terraform — and are the normal way a developer
> uses this feature day to day.

## 1. What this feature grants

| Change | Component | What it does |
| --- | --- | --- |
| `enable_execute_command = true` | `compute` (`aws_ecs_service.backend`) | Hosts the ECS Exec SSM sidecar agent inside the running backend task |
| `HostEcsExecSession` statement | `secrets` (`aws_iam_role_policy.task`) | Lets the task's own identity open the SSM control/data channels its Exec sidecar needs |
| `aws_iam_group_policy.developers_rds_troubleshooting` | `compute`, attached to the existing `crewsafe-developers` group (SCRUM-372) | Grants developers `ecs:ExecuteCommand`, `ssm:StartSession` (task ARN **and** the `AWS-StartPortForwardingSessionToRemoteHost` SSM document ARN), and `secretsmanager:GetSecretValue` scoped to the RDS-managed secret |

**Prerequisite**: an existing SCRUM-372 IAM identity in the `crewsafe-developers` group. This
feature adds no new identity — see `docs/runbooks/SCRUM-372-developer-readonly-iam-users.md` for
onboarding.

**Local prerequisite** (one time, per workstation):

```bash
brew install --cask session-manager-plugin   # macOS
session-manager-plugin                        # confirms it's on PATH
```

## 2. Discover the running task

```bash
export AWS_PROFILE=crewsafe-shared-dev   # your own configured profile for this identity

TASK_ARN=$(aws ecs list-tasks --cluster crewsafe-shared-dev --service-name backend \
  --desired-status RUNNING --query 'taskArns[0]' --output text)
TASK_ID=$(basename "$TASK_ARN")

RUNTIME_ID=$(aws ecs describe-tasks --cluster crewsafe-shared-dev --tasks "$TASK_ID" \
  --query 'tasks[0].containers[0].runtimeId' --output text)

# Sanity check before attempting a session — confirms the Exec sidecar is actually up
aws ecs describe-tasks --cluster crewsafe-shared-dev --tasks "$TASK_ID" \
  --query 'tasks[0].containers[0].managedAgents'
# expect one entry: name ExecuteCommandAgent, lastStatus RUNNING
```

## 3. Open the tunnel

The SSM target format for an ECS Exec session is `ecs:<cluster>_<task-id>_<runtime-id>` — not a
plain task ARN or an EC2 instance ID.

```bash
DB_ENDPOINT=$(aws rds describe-db-instances --db-instance-identifier crewsafe-shared-dev \
  --query 'DBInstances[0].Endpoint.Address' --output text)

aws ssm start-session \
  --target "ecs:crewsafe-shared-dev_${TASK_ID}_${RUNTIME_ID}" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"${DB_ENDPOINT}\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"15432\"]}"
```

This is a long-running foreground process — leave it open in its own terminal (or background it)
while you connect in step 5. Expect:

```text
Starting session with SessionId: <your-username>-<session-id>
Port 15432 opened for sessionId <your-username>-<session-id>.
Waiting for connections...
```

## 4. Retrieve the RDS-managed credential

`secretsmanager:ListSecrets` is **not** granted (by design — the grant is scoped to
`GetSecretValue` only, on the `rds!*` naming pattern). Get the exact secret ARN from the RDS
instance's own metadata instead of listing secrets:

```bash
SECRET_ARN=$(aws rds describe-db-instances --db-instance-identifier crewsafe-shared-dev \
  --query 'DBInstances[0].MasterUserSecret.SecretArn' --output text)

aws secretsmanager get-secret-value --secret-id "$SECRET_ARN" --query SecretString --output text \
  | python3 -m json.tool
```

Note the `username` and `password` fields. Do not write this output to a file that outlives the
session — the live verification for this feature read it straight into a shell variable and
discarded it immediately after connecting (step 5).

## 5. Connect

```bash
PGPASSWORD='<password from step 4>' psql \
  "host=localhost port=15432 dbname=crewsafe user=<username from step 4> sslmode=require"
```

A successful connection returns a `crewsafe=>` prompt. `SELECT current_database(), current_user,
version();` is a good first query to confirm you're where you expect.

## 6. Clean up

```bash
# In the tunnel's terminal: Ctrl+C, or if backgrounded:
kill %1   # or the tunnel's PID

unset PGPASSWORD
```

Never leave the retrieved secret value in a file, shell history persisted beyond the session, or
a chat log.

## 7. Troubleshooting — three real failures hit during live testing

| Symptom | Cause | Fix |
| --- | --- | --- |
| `AccessDeniedException ... ssm:StartSession ... on resource: ...document/AWS-StartPortForwardingSessionToRemoteHost` | The group policy's `ssm:StartSession` statement was scoped only to the ECS task ARN. AWS authorizes this specific session type against **both** the task target and the SSM document resource. | Fixed in the shipped grant (`StartSessionToBackendTask` statement includes both resources) — if you see this, the applied policy is stale; confirm `compute-shared-dev` was actually applied. |
| `TargetNotConnected: ecs:...  is not connected` | The already-running task's Exec sidecar tried (and failed) to open its SSM control channel before the task role had the `ssmmessages` grant (i.e. before `secrets-shared-dev` was applied), and doesn't retroactively retry. | Force a fresh deployment so a new task starts under the corrected task-role permissions: **GitHub Actions → Backend CI → Run workflow**, `redeploy: true`, `redeploy_image_tag: <current commit SHA>`. Re-check `managedAgents` (step 2) shows `RUNNING` with a fresh `lastStartedAt` before retrying. |
| `InvalidDocument: Document with name AWS-StartPortForwardingToRemoteHost does not exist` | Typo — the real AWS-owned document name has "Session" in it: `AWS-StartPortForwardingSessionToRemoteHost`. | Already corrected in the shipped grant and in this runbook's commands above. |

If none of these match: confirm you're using an identity that's both in `crewsafe-developers`
(SCRUM-372) **and** covered by this feature's additional grant (they're the same group — a
teammate onboarded to SCRUM-372 after this feature shipped gets both automatically), and that
`aws sts get-caller-identity` resolves to the expected `arn:aws:iam::<ACCOUNT_ID>:user/crewsafe/developers/<you>`.

## 8. What this does not grant

- No console or CLI browsing beyond what `ViewOnlyAccess` (SCRUM-372) already provides —
  `ecs:Describe*`, `ecs:List*`, `rds:DescribeDBInstances` come from that grant, not this one.
- No write access to the database beyond whatever the `crewsafe` role's own SQL privileges allow
  — this feature grants network/credential *reach*, not a new SQL permission.
- No standing bastion, no new IAM identity, no security-group or `publicly_accessible` change.
