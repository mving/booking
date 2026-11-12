resource "aws_cognito_user_pool" "booking_pool" {
  name = "booking-users-pool"

  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  # Verificación obligatoria de email en Cognito
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  email_verification_subject = "Código de verificación - Sistema de Reservas"
  email_verification_message = "Tu código de verificación para el Sistema de Reservas del Edificio es: {####}"

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
    require_uppercase = false
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  lambda_config {
    pre_sign_up = aws_lambda_function.pre_signup.arn
  }
}

resource "aws_cognito_identity_provider" "google_provider" {
  user_pool_id  = aws_cognito_user_pool.booking_pool.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    authorize_scopes = "email openid profile"
    client_id        = local.google_sso_creds.client_id
    client_secret    = local.google_sso_creds.client_secret
  }

  attribute_mapping = {
    email          = "email"
    email_verified = "email_verified"
    given_name     = "given_name"
    family_name    = "family_name"
    username       = "sub"
  }

  lifecycle {
    ignore_changes = [provider_details]
  }
}

resource "aws_cognito_user_pool_client" "booking_client" {
  name                                 = "booking-web-client"
  user_pool_id                         = aws_cognito_user_pool.booking_pool.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code", "implicit"]
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  supported_identity_providers         = ["Google", "COGNITO"]

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH"
  ]

  # Callback canónico para la SPA (el slug del edificio viaja en el parámetro OAuth2 state)
  callback_urls = [
    "http://localhost:5173",
    "http://localhost:5173/",
    "http://localhost:5173/auth/callback",
    "https://${aws_cloudfront_distribution.frontend_distribution.domain_name}",
    "https://${aws_cloudfront_distribution.frontend_distribution.domain_name}/",
    "https://${aws_cloudfront_distribution.frontend_distribution.domain_name}/auth/callback"
  ]

  logout_urls = [
    "http://localhost:5173",
    "http://localhost:5173/",
    "https://${aws_cloudfront_distribution.frontend_distribution.domain_name}",
    "https://${aws_cloudfront_distribution.frontend_distribution.domain_name}/"
  ]

  id_token_validity      = 60
  access_token_validity  = 60
  refresh_token_validity = 30

  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }

  depends_on = [
    aws_cognito_identity_provider.google_provider
  ]
}

resource "random_string" "suffix" {
  length  = 6
  special = false
  upper   = false
}

resource "aws_cognito_user_pool_domain" "main" {
  domain       = "booking-sso-${random_string.suffix.result}"
  user_pool_id = aws_cognito_user_pool.booking_pool.id
}

resource "aws_lambda_permission" "allow_cognito_pre_signup" {
  statement_id  = "AllowExecutionFromCognitoPreSignUp"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.pre_signup.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.booking_pool.arn
}

