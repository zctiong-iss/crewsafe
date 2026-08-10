# SCRUM-271 — Automated staging release deployment

The approved design deploys a digest-verified backend release through a dedicated main-branch
GitHub OIDC role, while replacing the obsolete web ECR publication job with SCRUM-298's S3 and
CloudFront deployment contract. Terraform remains CI-only; the role is provisioned by the existing
`compute-shared-dev` component. Full local planning artifacts remain gitignored under `specs/`.
