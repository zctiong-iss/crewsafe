# Terraform Architecture

This is the infrastructure architecture **declared in this repository**, derived
from the Terraform component catalogue and roots under `infra/terraform/`. It is
not a live AWS inventory: a merged Terraform change is not deployed until its
reviewed CI plan and apply complete. Terraform runs in CI only.

PlantUML source: [`terraform-architecture.puml`](terraform-architecture.puml)

DevSecOps toolchain source: [`devsecops-toolchain.puml`](devsecops-toolchain.puml)

```mermaid
%%{init: {
  "theme": "base",
  "themeVariables": {
    "fontFamily": "Arial, sans-serif",
    "fontSize": "15px",
    "primaryTextColor": "#17202a",
    "lineColor": "#455a64",
    "edgeLabelBackground": "#ffffff"
  },
  "flowchart": {
    "nodeSpacing": 65,
    "rankSpacing": 85,
    "htmlLabels": true,
    "useMaxWidth": false
  }
}}%%
flowchart LR
  browser[Browser]
  mobile[Mobile / CLI<br/>client]
  github[GitHub Actions<br/>CI + release]
  nea[NEA weather API]
  bedrock[Bedrock<br/>Claude models]
  sonar[SonarCloud]

  subgraph aws[AWS account · ap-southeast-1 · shared-dev]
    cognito[Cognito<br/>OAuth clients]

    subgraph webedge[Web delivery]
      webcf[CloudFront: web<br/>viewer HTTPS]
      webbucket[Private S3 web bucket<br/>OAC-only read access]
      weblogs[S3 web_logs<br/>access logs · 30d]
    end

    subgraph apiedge[API delivery]
      apicf[CloudFront: API<br/>viewer HTTPS]
      alb[Public ALB<br/>CloudFront prefix-list<br/>only]
    end

    subgraph vpc[VPC · two Availability Zones]
      nat[NAT gateway<br/>single egress AZ]
      subgraph backendtask[Backend ECS task · one ENI]
        ecs[ECS Fargate: backend<br/>private · no public IP]
        mlservice[ml-service sidecar<br/>localhost:8000 only<br/>essential · task-coupled]
      end
      rds[RDS PostgreSQL<br/>private · TLS]
    end

    ecr[ECR<br/>backend + web + ml-service<br/>immutable + scan]
    ssm[SSM<br/>runtime config]
    secrets[Secrets Manager<br/>weather + RDS creds]
    logs[CloudWatch<br/>app + DB + ml-service logs]
    securityhub[Security Hub<br/>Inspector + Sonar]
    importer[OIDC importer<br/>BatchImport only]
    state[Versioned S3 state<br/>account-isolated]
  end

  browser -->|sign in| cognito
  mobile -->|sign in| cognito
  browser -->|SPA| webcf -->|OAC read| webbucket
  webbucket -->|access logs| weblogs
  browser -->|API| apicf -->|HTTP origin| alb -->|health checks| ecs
  mobile -->|API| apicf
  cognito -.->|issuer + JWKS| ecs
  ecs -->|JDBC TLS| rds
  ecs -->|config| ssm
  ecs -->|secrets| secrets
  ecs -->|image| ecr
  ecs -->|logs| logs
  ecs -->|localhost:8000<br/>same task ENI| mlservice
  mlservice -->|image| ecr
  mlservice -->|logs| logs
  mlservice -->|config secrets<br/>manifest unset today| secrets
  rds -->|logs| logs
  ecs -->|egress| nat --> nea
  mlservice -->|egress<br/>task role InvokeModel| nat --> bedrock
  ecr -.->|Inspector| securityhub

  github -->|publish| ecr
  github -->|web sync| webbucket
  github -->|import role| importer -->|redacted import| securityhub
  sonar -.->|findings| github
  github -->|Terraform OIDC| state

  classDef client fill:#f5f5f5,stroke:#616161,color:#212121,font-size:15px;
  classDef edge fill:#e3f2fd,stroke:#1565c0,color:#0d47a1,font-size:15px;
  classDef compute fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20,font-size:15px;
  classDef data fill:#fff3e0,stroke:#ef6c00,color:#e65100,font-size:15px;
  classDef ops fill:#f3e5f5,stroke:#7b1fa2,color:#4a148c,font-size:15px;
  class browser,mobile,github,nea,bedrock,sonar client;
  class cognito,webcf,apicf,alb edge;
  class nat,ecs,mlservice compute;
  class webbucket,weblogs,rds,ecr,ssm,secrets data;
  class logs,securityhub,importer,state ops;
```

## Runtime boundaries

- The web SPA and backend API have **separate CloudFront distributions and
  hostnames**. The web distribution reads a private, versioned S3 bucket through
  Origin Access Control; it has no ECS, ALB, or VPC dependency. The web bucket
  delivers its own S3 server access logs to a dedicated, private, encrypted
  `web_logs` bucket (30-day lifecycle expiry) behind a least-privilege delivery
  policy scoped to the web bucket's own ARN (SonarQube `terraform:S6258`).
- API traffic is CloudFront → public ALB → private ECS task. The ALB accepts its
  origin traffic only from AWS's managed CloudFront prefix list. The temporary
  CloudFront-to-ALB origin transport is HTTP on port 80 because the AWS-owned ALB
  hostname has no project-controlled certificate; viewer traffic is redirected to
  HTTPS and application authentication/authorisation remains server-side.
- The backend task has no public IP. Its application security group is the sole
  allowed source to PostgreSQL on TCP 5432; the database security group declares
  no egress rule. A single NAT gateway provides private workload egress, including
  weather ingestion.
- ECS task execution and task roles are separate. Execution resolves image layers,
  logs, configuration and secret references; the running task role is restricted
  to the application reads it needs. Neither Terraform outputs nor this diagram
  expose credential values.
- `ml-service` runs as a **second container inside the same backend ECS task**, not
  a standalone service: Fargate `awsvpc` mode gives both containers one ENI, so
  `backend` reaches it over `localhost:8000` with no ALB target group, listener,
  service-discovery entry, or security-group ingress of its own — it is
  unreachable from outside the task. It is `essential: true`, so its failure stops
  the whole task, and it shares the backend task role, including a narrowly scoped
  `bedrock:InvokeModel` grant (exactly the Claude model identifiers `ml-service`
  and `backend` invoke — never `bedrock:*`, never a resource wildcard). The
  `WBGT_MODEL_MANIFEST`/`WBGT_MODEL_MANIFEST_SHA256` configuration entries now
  point at the checksum-verified `staging-demo-v1` bundle baked into the
  `ml-service` image (SCRUM-114/SCRUM-373) — activated for the shared staging
  demonstration only, not a production model approval; a manifest/checksum
  mismatch still fails safely to the persistence baseline.
- ECR provides immutable, scan-on-push backend, web, and ml-service repositories,
  each with its own scoped push role. The deployed web app is a static S3 sync,
  not an ECR runtime consumer. Terraform deliberately ignores the ECS service's
  task-definition revision and desired count: the reviewed release workflow is
  authoritative for the running backend (and ml-service sidecar) revision.
- Security Hub receives Inspector ECR findings. The separately provisioned,
  main-branch GitHub OIDC role can import narrowly redacted eligible SonarCloud
  findings; it has no remediation or ticket-creation permission.

## Terraform component contracts

The [component catalogue](../../.github/terraform/components.json) is the
authoritative inventory of deployable roots. All managed components use a distinct
key in the account-isolated S3 state bucket. The `state-backend` component is the
exception: it self-bootstraps before using its own remote key.

```mermaid
%%{init: {
  "theme": "base",
  "themeVariables": {
    "fontFamily": "Arial, sans-serif",
    "fontSize": "15px",
    "primaryTextColor": "#17202a",
    "lineColor": "#455a64",
    "edgeLabelBackground": "#ffffff"
  },
  "flowchart": {
    "nodeSpacing": 70,
    "rankSpacing": 90,
    "htmlLabels": true,
    "useMaxWidth": false
  }
}}%%
flowchart LR
  gha[GitHub Actions<br/>OIDC · reviewed CI]
  state[Versioned S3 state<br/>account-isolated]
  bootstrap[State backend<br/>bootstrap/terraform.tfstate]
  cognito[Cognito<br/>cognito/shared-dev.tfstate]
  secrets[Secrets<br/>secrets/shared-dev.tfstate]
  network[Network<br/>network/shared-dev.tfstate]
  database[Database<br/>database/shared-dev.tfstate]
  ecr[ECR<br/>ecr/shared-dev.tfstate]
  compute[Compute<br/>compute/shared-dev.tfstate]
  iam[IAM policy mgmt<br/>iam-policy-management/shared-dev.tfstate]
  devaccess[Developer access<br/>developer-access/shared-dev.tfstate]
  importer[SecurityHub import<br/>securityhub-import/shared-dev.tfstate]

  gha --> bootstrap
  gha --> cognito
  gha --> secrets
  gha --> network
  gha --> database
  gha --> ecr
  gha --> compute
  gha --> iam
  gha --> devaccess
  gha --> importer
  bootstrap -.->|creates| state
  cognito -.->|Cognito outputs| secrets
  network -.->|network outputs| database
  network -.->|network outputs| compute
  secrets -.->|secret outputs| database
  secrets -.->|secret outputs| compute
  database -.->|database outputs| compute
  ecr -.->|ECR outputs| compute
  cognito -.-> state
  secrets -.-> state
  network -.-> state
  database -.-> state
  ecr -.-> state
  compute -.-> state
  iam -.-> state
  devaccess -.-> state
  importer -.-> state
```

`iam-policy-management-shared-dev` is intentionally not shown as a remote-state
consumer: it centrally creates and attaches reviewed Terraform plan/apply policies
to the pre-existing GitHub OIDC roles. `securityhub-import-shared-dev` independently
creates the narrow SonarCloud-to-Security-Hub importer role.
`developer-access-shared-dev` independently creates the read-only
`crewsafe-developers` IAM group (AWS-managed `ViewOnlyAccess`) and its member
users. None of the three creates a runtime application dependency or consumes
another component's outputs.

## DevSecOps toolchain

The repository implements the following CI/CD and security flow. Checks run on pull
requests and pushes where the workflow is scoped; promotion and infrastructure
mutation remain controlled main-branch workflows.

The detailed standalone PlantUML version is
[`devsecops-toolchain.puml`](devsecops-toolchain.puml); it includes the CI lanes,
OIDC roles, artifact flow, plan/apply controls and evidence paths.

```mermaid
%%{init: {
  "theme": "base",
  "themeVariables": {
    "fontFamily": "Arial, sans-serif",
    "fontSize": "15px",
    "primaryTextColor": "#17202a",
    "lineColor": "#455a64",
    "edgeLabelBackground": "#ffffff"
  },
  "flowchart": {
    "nodeSpacing": 65,
    "rankSpacing": 85,
    "htmlLabels": true,
    "useMaxWidth": false
  }
}}%%
flowchart LR
  dev[Developer]
  actions[GitHub Actions<br/>PR · push · schedule · dispatch]

  subgraph build[Build and test]
    backend[Backend CI<br/>Java 21 · Maven]
    web[Web CI<br/>Node 22 · test]
    mobile[Mobile CI<br/>Node 22 · test]
    mlservice[ml-service CI<br/>Python · pytest]
  end

  subgraph security[Security gates]
    secrets[Secret scan<br/>gitleaks · fail closed]
    sast[SAST / SCA<br/>SonarCloud]
    iac[IaC scan<br/>Terraform · Trivy]
    selftests[Gate self-tests]
  end

  subgraph artifacts[Reviewed artifacts]
    ecr[ECR<br/>immutable images]
    s3[S3<br/>versioned web bundle]
    plan[Terraform plan<br/>exact bundle]
  end

  subgraph delivery[Controlled delivery]
    ecs[ECS staging<br/>backend]
    webstg[CloudFront + S3<br/>web staging]
    apply[Terraform Apply<br/>main + confirmation]
    hub[Security Hub<br/>controlled import]
  end

  subgraph verify[Staging verification]
    smoke[Staging smoke<br/>auth + WBGT check]
    dast[Authenticated DAST<br/>OWASP ZAP baseline]
  end

  dev --> actions
  actions --> backend
  actions --> web
  actions --> mobile
  actions --> mlservice
  actions --> secrets
  actions --> sast
  actions --> iac
  actions --> selftests
  backend --> ecr --> ecs
  mlservice --> ecr
  web --> s3 --> webstg
  iac --> plan --> apply
  sast --> hub
  ecs --> smoke
  webstg --> smoke
  ecs --> dast
  webstg --> dast
```

Backend and web promotion uses immutable, commit-addressed artifacts. Terraform
mutation is CI-only and requires the exact reviewed plan, commit, account and typed
confirmation. Security scanning fails closed for unavailable secret scanning; the
SonarCloud analysis covers backend, web and mobile, with coverage generated before
analysis. The SonarCloud-to-Security-Hub path is a controlled, redacted import with no
remediation or ticket-creation permission. After a successful staging deploy, both the
backend and web release workflows call a shared staging-smoke check (synthetic sign-in
plus a WBGT read/forecast round trip) and an authenticated DAST scan (ZAP baseline
against the deployed staging origins); both run as post-deploy evidence and do not roll
back or gate the release that already happened.

## Manual operational workflows

Two further workflow families exist outside the push/PR pipeline above: they are
`workflow_dispatch`-only, gated to `github.ref == 'refs/heads/main'`, and never
triggered by a push or a pull request.

- **Mobile security testing** (`mobile-native-build.yml` → `mobsf-dynamic-scan.yml`,
  SCRUM-348/SCRUM-350): builds a non-store Android/iOS artifact for internal security
  testing and QA only — a structural test fails the build if a Play Store/App
  Store/TestFlight step is ever added — then, given a build produced with
  `auth_mode=cognito-password`, drives MobSF dynamic analysis with a Maestro-scripted
  sign-in/API-call/sign-out flow against the real staging backend. Findings are
  recorded as CI evidence and are non-blocking this iteration.
- **Cognito operations** (`cognito-mapping-publication.yml`,
  `cognito-user-administration.yml`): publish the staging Cognito app-client mapping
  and perform an allowlisted set of user/group administration operations (inspect,
  list, enable/disable, password reset, forced global sign-out, group membership,
  synthetic-worker lifecycle). Every state-changing call requires a typed
  `<operation> <alias> <subject>` confirmation phrase, mirroring the Terraform Apply
  gate's confirmation pattern.

The detailed standalone PlantUML page for both flows is the third page of
[`devsecops-toolchain.puml`](devsecops-toolchain.puml).

## Declared component inventory

| Component | Responsibility | Upstream Terraform state |
| --- | --- | --- |
| `state-backend` | Account-isolated, versioned and protected state bucket | Self-bootstrap |
| `cognito-shared-dev` | Shared user pool, OAuth clients, groups and administration role | — |
| `network-shared-dev` | VPC, two-AZ public/private subnets, NAT, app and database security groups | — |
| `secrets-shared-dev` | Runtime configuration (incl. `ml-service` model-manifest SSM parameters), weather-secret container and ECS roles | Cognito |
| `database-shared-dev` | PostgreSQL, subnet/parameter groups, logs and connection configuration | Network, secrets |
| `ecr-shared-dev` | Backend/web/ml-service repositories, each with a scoped push role, Inspector scanning and Security Hub insight | — |
| `compute-shared-dev` | Backend ECS/ALB/API edge (with the ml-service sidecar container, SCRUM-373) and static web S3/CloudFront delivery | Network, secrets, database, ECR |
| `iam-policy-management-shared-dev` | Centrally managed least-privilege Terraform CI policies and attachments | — |
| `developer-access-shared-dev` | Individual read-only developer IAM console/CLI users and group policy | — |
| `securityhub-import-shared-dev` | OIDC role restricted to controlled SonarCloud finding imports | — |

## Deliberate limitations and follow-ups

- `ml-service` is declared and deployed (SCRUM-373) as a same-task ECS sidecar —
  it is no longer an undeclared, product-plan-only target. What remains
  deliberately undeclared: an agent runtime, mobile deployment runtime,
  EventBridge scheduling, or production custom domains/certificates. Those
  remain product-plan targets, not current Terraform resources.
- `ml-service`'s trained-model activation is now live for a time-limited,
  explicitly non-production exception: `WBGT_MODEL_MANIFEST`/
  `WBGT_MODEL_MANIFEST_SHA256` point at the checksum-pinned `staging-demo-v1`
  bundle baked into the `ml-service` image (SCRUM-114/SCRUM-373, accepted by
  decision owner Bryan Phang on 16 August 2026 as a university-project staging
  demonstration only — `ml-service/MODEL_CARD.md`). It does not satisfy the
  normal 21-day post-freeze production-evidence procedure, does not alter the
  deterministic policy or human-approval boundaries, and a manifest/checksum
  mismatch still fails safely to the persistence baseline — see
  `docs/runbooks/SCRUM-373-ml-service-deploy.md` §8.0 for the exception and
  §8 generally for the value-only parameter-plus-redeploy activation path (no
  task-definition or Terraform-shape change).
- A model bundle shipped via S3 rather than baked into the `ml-service` image is
  explicitly out of scope for this architecture; no S3 read permission exists on
  either ECS identity for that purpose. The one trained candidate that exists
  today sits in a SageMaker Studio experiment output in **a separate AWS
  account** (`087819194272`, `ap-southeast-2`) — not the account this
  architecture's `secrets`/`compute`/`ecr` deploy to (`ap-southeast-1` only;
  `secrets/variables.tf` rejects any other region), and not one this diagram
  connects to, since no cross-account IAM trust or Terraform dependency exists
  between them. Promoting that candidate is a manual, out-of-band pull
  performed on a developer's own workstation, never a live or CI-driven
  fetch — see `docs/runbooks/SCRUM-373-ml-service-deploy.md` §8.1 for its
  exact bucket/prefix inventory and §8.2 for the promotion steps.
- Both CloudFront distributions use provider-issued hostnames. Their declared
  default-certificate setting therefore has a TLS 1.0 minimum; raising that floor
  requires a project-controlled domain, ACM certificate in `us-east-1`, and DNS
  work as a separately reviewed change.
- The diagram intentionally does not represent Terraform state as a source of
  truth for the running ECS revision, credentials, live configuration values, or
  AWS inventory. Consult the reviewed deployment workflows and AWS service
  observations for operational state.
