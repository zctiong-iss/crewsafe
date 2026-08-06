# ADR 0014 — Digest-pinned unprivileged runtime for the web image

**Status:** Accepted  
**Date:** 2026-08-06  
**Jira:** SCRUM-257

## Context

SCRUM-257 publishes the React/Vite web build produced by `web-ci.yml`. The image must
serve static assets and client-side routes without carrying the Node build toolchain into
the runtime layer. The image is built in CI and later consumed by deployment work; this
decision does not add deployment or runtime-pull verification.

## Decision

Use a two-stage Dockerfile:

- Build with the digest-pinned Node 22 Bookworm image, install from
  `package-lock.json` with `npm ci`, and emit `dist/` with the reviewed production build.
- Serve only `dist/` with the digest-pinned `nginxinc/nginx-unprivileged` Alpine image
  (currently `1.31.3-alpine3.24`).
  Nginx listens on port 8080, runs as `nginx`, sets baseline response headers, and falls
  back to `index.html` for client-side routes.
- Exclude source-control metadata, dependencies, build output, local environment files,
  test output, and editor files from the Docker context.

The base image manifest digests are explicit in `web/Dockerfile`. No Vite environment
value is passed as a Docker build argument; environment-specific configuration remains a
future deployment/runtime contract.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Single Node image running Vite preview | Retains the build toolchain and development-oriented server in the runtime artifact. |
| Floating `node`/`nginx` tags | Makes a reviewed build non-reproducible and permits unreviewed base-image changes. |
| Privileged default Nginx image | Adds unnecessary runtime privilege and requires extra port/user handling. |

## Consequences

The runtime image is smaller and has a narrower process boundary, while CI pays the cost
of a separate build stage and a blocking Trivy image scan. Updating either base image
requires refreshing its digest and rerunning the image/security checks. Deployment,
environment injection, and pull-role configuration remain outside this issue.
