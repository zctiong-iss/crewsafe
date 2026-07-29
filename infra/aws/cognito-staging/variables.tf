variable "region" {
  description = "AWS region to create the user pool in."
  type        = string
  default     = "ap-southeast-1"
}

variable "environment" {
  description = "Environment name. Used in the pool name and tags."
  type        = string
  default     = "staging"
}

variable "hosted_ui_domain" {
  description = "Hosted UI domain prefix. Must be globally unique across all of AWS, so include something project-specific (e.g. crewsafe-staging-8f2a)."
  type        = string
}

variable "web_callback_urls" {
  description = "Where Cognito may redirect after login for the web app."
  type        = list(string)
  default     = ["http://localhost:5173/callback"]
}

variable "web_logout_urls" {
  description = "Where Cognito may redirect after logout for the web app."
  type        = list(string)
  default     = ["http://localhost:5173/"]
}

variable "mobile_callback_urls" {
  description = "Where Cognito may redirect after login for the mobile app."
  type        = list(string)
  default     = ["crewsafe://callback"]
}

variable "mobile_logout_urls" {
  description = "Where Cognito may redirect after logout for the mobile app."
  type        = list(string)
  default     = ["crewsafe://"]
}

variable "demo_usernames" {
  description = "Demo accounts to create. Must match the usernames DemoDataSeeder expects."
  type        = list(string)
  default     = ["supervisor1", "supervisor2", "worker1", "worker2", "worker3", "manager1", "admin1"]
}

variable "demo_user_password" {
  description = "Permanent password shared by the demo accounts. Must satisfy the pool's password policy (12+ chars, upper, lower, digit)."
  type        = string
  sensitive   = true
}
