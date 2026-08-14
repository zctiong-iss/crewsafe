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
  sonar[SonarCloud]

  subgraph aws[AWS account · ap-southeast-1 · shared-dev]
    cognito[Cognito<br/>OAuth clients]

    subgraph webedge[Web delivery]
      webcf[CloudFront: web<br/>viewer HTTPS]
      webbucket[Private S3 web bucket<br/>OAC-only read access]
    end

    subgraph apiedge[API delivery]
      apicf[CloudFront: API<br/>viewer HTTPS]
      alb[Public ALB<br/>CloudFront prefix-list<br/>only]
    end

    subgraph vpc[VPC · two Availability Zones]
      nat[NAT gateway<br/>single egress AZ]
      ecs[ECS Fargate<br/>private · no public IP]
      rds[RDS PostgreSQL<br/>private · TLS]
    end

    ecr[ECR<br/>backend + web<br/>immutable + scan]
    ssm[SSM<br/>runtime config]
    secrets[Secrets Manager<br/>weather + RDS creds]
    logs[CloudWatch<br/>app + DB logs]
    securityhub[Security Hub<br/>Inspector + Sonar]
    importer[OIDC importer<br/>BatchImport only]
    state[Versioned S3 state<br/>account-isolated]
  end

  browser -->|sign in| cognito
  mobile -->|sign in| cognito
  browser -->|SPA| webcf -->|OAC read| webbucket
  browser -->|API| apicf -->|HTTP origin| alb -->|health checks| ecs
  mobile -->|API| apicf
  cognito -.->|issuer + JWKS| ecs
  ecs -->|JDBC TLS| rds
  ecs -->|config| ssm
  ecs -->|secrets| secrets
  ecs -->|image| ecr
  ecs -->|logs| logs
  rds -->|logs| logs
  ecs -->|egress| nat --> nea
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
  class browser,mobile,github,nea,sonar client;
  class cognito,webcf,apicf,alb edge;
  class nat,ecs compute;
  class webbucket,rds,ecr,ssm,secrets data;
  class logs,securityhub,importer,state ops;
```

## Runtime boundaries

- The web SPA and backend API have **separate CloudFront distributions and
  hostnames**. The web distribution reads a private, versioned S3 bucket through
  Origin Access Control; it has no ECS, ALB, or VPC dependency.
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
- ECR provides immutable, scan-on-push backend and web repositories. The deployed
  web app is a static S3 sync, not an ECR runtime consumer. Terraform deliberately
  ignores the ECS service's task-definition revision and desired count: the
  reviewed release workflow is authoritative for the running backend revision.
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
  importer[SecurityHub import<br/>securityhub-import/shared-dev.tfstate]

  gha --> bootstrap
  gha --> cognito
  gha --> secrets
  gha --> network
  gha --> database
  gha --> ecr
  gha --> compute
  gha --> iam
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
  importer -.-> state
```

`iam-policy-management-shared-dev` is intentionally not shown as a remote-state
consumer: it centrally creates and attaches reviewed Terraform plan/apply policies
to the pre-existing GitHub OIDC roles. `securityhub-import-shared-dev` independently
creates the narrow SonarCloud-to-Security-Hub importer role. Neither component
creates a runtime application dependency.

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

  dev --> actions
  actions --> backend
  actions --> web
  actions --> mobile
  actions --> secrets
  actions --> sast
  actions --> iac
  actions --> selftests
  backend --> ecr --> ecs
  web --> s3 --> webstg
  iac --> plan --> apply
  sast --> hub
```

Backend and web promotion uses immutable, commit-addressed artifacts. Terraform
mutation is CI-only and requires the exact reviewed plan, commit, account and typed
confirmation. Security scanning fails closed for unavailable secret scanning; the
SonarCloud analysis covers backend, web and mobile, with coverage generated before
analysis. The SonarCloud-to-Security-Hub path is a controlled, redacted import with no
remediation or ticket-creation permission.

## Declared component inventory

| Component | Responsibility | Upstream Terraform state |
| --- | --- | --- |
| `state-backend` | Account-isolated, versioned and protected state bucket | Self-bootstrap |
| `cognito-shared-dev` | Shared user pool, OAuth clients, groups and administration role | — |
| `network-shared-dev` | VPC, two-AZ public/private subnets, NAT, app and database security groups | — |
| `secrets-shared-dev` | Runtime configuration, weather-secret container and ECS roles | Cognito |
| `database-shared-dev` | PostgreSQL, subnet/parameter groups, logs and connection configuration | Network, secrets |
| `ecr-shared-dev` | Backend/web repositories, Inspector scanning and Security Hub insight | — |
| `compute-shared-dev` | Backend ECS/ALB/API edge and static web S3/CloudFront delivery | Network, secrets, database, ECR |
| `iam-policy-management-shared-dev` | Centrally managed least-privilege Terraform CI policies and attachments | — |
| `developer-access-shared-dev` | Individual read-only developer IAM console/CLI users and group policy | — |
| `securityhub-import-shared-dev` | OIDC role restricted to controlled SonarCloud finding imports | — |

## Deliberate limitations and follow-ups

- This shared-development architecture does not declare the planned internal ML
  service, agent runtime, mobile deployment runtime, EventBridge scheduling, or
  production custom domains/certificates. They remain product-plan targets, not
  current Terraform resources.
- Both CloudFront distributions use provider-issued hostnames. Their declared
  default-certificate setting therefore has a TLS 1.0 minimum; raising that floor
  requires a project-controlled domain, ACM certificate in `us-east-1`, and DNS
  work as a separately reviewed change.
- The diagram intentionally does not represent Terraform state as a source of
  truth for the running ECS revision, credentials, live configuration values, or
  AWS inventory. Consult the reviewed deployment workflows and AWS service
  observations for operational state.
