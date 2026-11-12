# Reutiliza las credenciales de Google SSO ya configuradas en la misma cuenta de AWS
data "aws_ssm_parameter" "google_sso" {
  name            = var.google_sso_ssm_parameter_name
  with_decryption = true
}

locals {
  google_sso_creds = try(
    jsondecode(data.aws_ssm_parameter.google_sso.value),
    {
      client_id     = "COMPLETAR_EN_SSM_PARAMETER_STORE"
      client_secret = "COMPLETAR_EN_SSM_PARAMETER_STORE"
    }
  )
}

# Secreto para firmar tokens temporales de validación de contraseña de edificio (registration_token)
resource "random_password" "registration_token_secret" {
  length  = 48
  special = false
}

# Secreto compartido entre CloudFront y API Gateway Resource Policy para prevenir evasión directa
resource "random_password" "cloudfront_origin_secret" {
  length  = 40
  special = false
}

