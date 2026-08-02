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
      Jira        = "SCRUM-176"
    }
  }
}
