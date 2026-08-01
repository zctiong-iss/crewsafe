terraform {
  required_version = ">= 1.10, < 2.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "crewsafe"
      Environment = "shared-dev"
      ManagedBy   = "terraform"
      # PLACEHOLDER - SCRUM-999999 is not a real Jira issue. It exists only because
      # components.schema.json requires jira_key to match ^SCRUM-[0-9]+$ and no infra
      # ticket exists yet for this component (Jira search confirmed none as of
      # 2026-08-02 - SCRUM-177 covers the CI pipeline that consumes this registry,
      # not the registry itself). Replace with the real ticket key here AND in
      # .github/terraform/components.json AND in the runbook filename/header at
      # docs/runbooks/SCRUM-999999-ecr-shared-dev.md the moment that ticket exists.
      Jira = "SCRUM-999999"
    }
  }
}
