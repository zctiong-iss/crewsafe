# Browser security policy for the S3/CloudFront SPA.

data "terraform_remote_state" "cognito" {
  backend = "s3"
  config = {
    bucket = "crewsafe-terraform-state-${var.expected_account_id}-${var.aws_region}"
    key    = "crewsafe/cognito/shared-dev.tfstate"
    region = var.aws_region
  }
}

locals {
  cognito = data.terraform_remote_state.cognito.outputs

  web_api_origin               = "https://${aws_cloudfront_distribution.main.domain_name}"
  web_cognito_authority_origin = "https://cognito-idp.${var.aws_region}.amazonaws.com"
  web_cognito_hosted_ui_origin = local.cognito.domain_url

  # A refresh-token renewal is a connection, not a frame. Do not add frame-src
  # unless browser evidence proves an intentional iframe flow exists.
  web_csp = join(" ", [
    "default-src 'self';",
    "script-src 'self';",
    "style-src 'self';",
    "img-src 'self' data:;",
    "font-src 'self';",
    "connect-src 'self' ${local.web_api_origin} ${local.web_cognito_authority_origin} ${local.web_cognito_hosted_ui_origin};",
    "form-action 'self';",
    "frame-ancestors 'none';",
    "object-src 'none';",
    "base-uri 'self'",
  ])
}

resource "aws_cloudfront_response_headers_policy" "web_security" {
  name    = "${local.name_prefix}-web-security-headers"
  comment = "Security headers for the CrewSafe SPA; CSP starts Report-Only."

  security_headers_config {
    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      override                   = true
    }
  }

  custom_headers_config {
    items {
      header   = "Content-Security-Policy-Report-Only"
      value    = local.web_csp
      override = true
    }

    items {
      header   = "Permissions-Policy"
      value    = "geolocation=(), camera=(), microphone=()"
      override = true
    }
  }
}