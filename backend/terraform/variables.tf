variable "aws_region" {
  description = "Región de AWS donde se despliega la infraestructura"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Nombre del entorno (prod, dev)"
  type        = string
  default     = "prod"
}

variable "project_name" {
  description = "Nombre del proyecto para etiquetado y prefijos"
  type        = string
  default     = "building-booking"
}

variable "google_sso_ssm_parameter_name" {
  description = "Nombre del parámetro existente en SSM Parameter Store con client_id y client_secret de Google SSO"
  type        = string
  default     = "google_sso_credentials"
}

variable "initial_global_admin_email" {
  description = "Email del Administrador Global inicial del sistema"
  type        = string
  default     = "admin@edificio.com"
}

