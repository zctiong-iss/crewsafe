# SCRUM-303 — Cognito mapping publication plan

## Approved design

Provide a main-only manual GitHub Actions operation to publish the reviewed application-user mapping for one registered staging account. Preflight has no AWS credentials and validates the actor allowlist, branch, confirmation, account registry, reviewed shared Cognito configuration, synthetic manifest, strict bound-only combined mapping, fixed parameter name, and derived role ARN. It emits only non-sensitive metadata and a mapping checksum.

The credentialed job independently re-derives the mapping, verifies the checksum, writes only `/crewsafe/shared-dev/cognito/demo-users-json`, resolves the existing `main` image by immutable digest, and uses the established backend deployment script. It accepts no parameter, role, image, ECS target, mapping, or credential input.

## IAM boundary

The dedicated `crewsafe-shared-dev-cognito-mapping-publish` OIDC role is trusted only by this repository's exact immutable main-branch subject. It is separate from the ordinary backend deployment role. Its permissions are limited to the fixed mapping parameter write, backend image inspection, the exact ECS actions required by the existing deployment script, and passing the two existing task roles to ECS tasks. It has no Cognito, Secrets Manager, or SSM read permissions.

## Safety and verification

The backend remains the sole server-side authority: a Cognito group does not grant CrewSafe access, and unmapped or inactive subjects remain denied. Mapping payloads are never sent between workflow jobs, printed, summarized, or attached as evidence. Terraform formatting, validation, and tests are CI-only; no local Terraform or AWS mutation is permitted. A post-merge controlled staging run is required before closing SCRUM-303.
