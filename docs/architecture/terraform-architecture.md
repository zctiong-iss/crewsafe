# Terraform Architecture

This diagram is derived from the Terraform roots under `infra/terraform/` and
describes the architecture declared for the shared development
environment. It is an infrastructure view, not a live AWS inventory; the
compute component deliberately lets CI own the running ECS task-definition
revision.

PlantUML source: [`terraform-architecture.puml`](terraform-architecture.puml)

```mermaid
%%{init: {
  "theme": "base",
  "themeVariables": {
    "fontFamily": "Arial, sans-serif",
    "fontSize": "20px",
    "primaryTextColor": "#17202a",
    "lineColor": "#455a64",
    "edgeLabelBackground": "#ffffff"
  },
  "flowchart": {
    "nodeSpacing": 55,
    "rankSpacing": 75,
    "htmlLabels": true
  }
}}%%
flowchart LR
  %% External actors and managed AWS services
  users[Web / mobile / CLI clients]
  github[GitHub Actions]
  weather[NEA / data.gov.sg weather API]

  subgraph aws[AWS account · ap-southeast-1 · shared-dev]
    subgraph edge[Public edge]
      cognito[Cognito User Pool\nweb · mobile · CLI clients\nOAuth tokens / JWKS]
      cf[CloudFront distribution\nviewer HTTPS\nHTTP origin to ALB]
    end

    subgraph vpc[VPC · two Availability Zones]
      igw[Internet Gateway]
      nat[NAT Gateway\nEIP · single egress AZ]

      subgraph public[Public subnets]
        alb[Public Application Load Balancer\nport 80 origin]
        albsg[ALB security group\nIngress: CloudFront managed prefix list]
      end

      subgraph private[Private subnets]
        ecs[ECS cluster + Fargate service\nCrewSafe backend tasks\nno public IP]
        appsg[Application security group\nIngress: ALB only\nEgress: outbound]
        rds[RDS PostgreSQL\nMulti-AZ subnet group placement\nTLS required]
        rdssg[Database security group\nIngress: app SG → TCP 5432\nNo egress rule]
      end
    end

    ecr[ECR repositories\ncrewsafe/backend + crewsafe/web\nimmutable tags · scan on push]
    ssm[SSM Parameter Store\n/crewsafe/shared-dev/*\nconfiguration + DB URL]
    secrets[Secrets Manager\nweather API key\nRDS-managed master credential]
    logs[CloudWatch Logs\nbackend: 14 days\nPostgreSQL: 7 days]

    subgraph state[Terraform state]
      s3[S3 versioned state bucket\nSSE-S3 · public access blocked\nseparate key per component]
    end
  end

  users -->|Sign in / obtain JWT| cognito
  users -->|API requests| cf
  cognito -.->|Issuer / JWKS / client IDs| ecs
  cf -->|Origin HTTP: 80| alb
  alb -->|Target group / health checks| ecs
  albsg -.->|Allows CloudFront prefix list| alb
  appsg -.->|Allows ALB container port| ecs
  ecs -->|JDBC TLS · TCP 5432| rds
  appsg -->|Referenced by DB ingress rule| rdssg
  rdssg -.->|Only app SG → 5432| rds
  private -->|Outbound internet only| nat
  nat --> igw
  alb --> igw

  github -->|Existing backend CI OIDC publisher| ecr
  ecr -->|Pull image layers at task start| ecs
  ecs -->|Read config parameters| ssm
  ecs -->|Read task secrets| secrets
  ecs -->|Write container logs| logs
  rds -->|Write PostgreSQL logs| logs
  ecs -->|Weather ingestion via NAT| weather

  %% Terraform component contracts / remote state
  network[Terraform: network]
  compute[Terraform: compute]
  database[Terraform: database]
  secrets_tf[Terraform: secrets]
  cognito_tf[Terraform: cognito]
  ecr_tf[Terraform: ecr]

  network -.->|vpc, subnet IDs, security groups| compute
  network -.->|private subnets, DB SG| database
  cognito_tf -.->|issuer, JWKS, client IDs| secrets_tf
  secrets_tf -.->|parameter prefix, IAM roles| compute
  secrets_tf -.->|parameter prefix, execution role| database
  database -.->|DB address, URL parameter, credential ARN| compute
  ecr_tf -.->|repository ARN / URL| compute

  github -->|Terraform plan/apply via OIDC| s3
  network -.-> s3
  compute -.-> s3
  database -.-> s3
  secrets_tf -.-> s3
  cognito_tf -.-> s3
  ecr_tf -.-> s3

  classDef external fill:#f5f5f5,stroke:#616161,color:#212121,font-size:20px;
  classDef edgeNode fill:#e3f2fd,stroke:#1565c0,color:#0d47a1,font-size:20px;
  classDef networkNode fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20,font-size:20px;
  classDef dataNode fill:#fff3e0,stroke:#ef6c00,color:#e65100,font-size:20px;
  classDef opsNode fill:#f3e5f5,stroke:#7b1fa2,color:#4a148c,font-size:20px;
  classDef tfNode fill:#eceff1,stroke:#455a64,color:#263238,font-size:20px;

  class users,github,weather external;
  class cognito,cf edgeNode;
  class igw,nat,alb,albsg,ecs,appsg networkNode;
  class rds,rdssg,ecr,ssm,secrets dataNode;
  class logs,s3 opsNode;
  class network,compute,database,secrets_tf,cognito_tf,ecr_tf tfNode;
```

## Architecture notes

- The ALB is public but only accepts origin traffic from CloudFront's AWS-managed
  prefix list; the backend remains in private subnets with no public IP.
- The single NAT gateway provides outbound access for private workloads. The
  database security group has the only database ingress rule and declares no
  egress rule.
- ECS task execution and task roles are separate. Execution reads image layers,
  logs, parameters, and secret references; the running application receives only
  its application secret reads.
- Cognito is provisioned separately and its issuer/JWKS/client identifiers flow
  into the secrets component through remote state before being consumed by ECS.
- Terraform state is account-isolated in one versioned S3 bucket, with an
  independent state key for each component. No DynamoDB lock table is declared.
- The shared ECR boundary contains the existing backend repository and the web repository
  provisioned by SCRUM-253. The GitHub Actions edge represents the existing backend publisher;
  the future web publisher is intentionally not represented until its follow-up workflow exists.
- `web/`, `mobile/`, ML, and agent runtimes are otherwise not represented because their
  Terraform roots do not yet exist.
