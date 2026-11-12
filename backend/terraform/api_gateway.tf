resource "aws_api_gateway_rest_api" "booking_api" {
  name        = "${var.project_name}-api"
  description = "API REST para el Sistema de Reservas de Amenities Multi-Edificio"
}

# Prevención de Evasión de CloudFront (Seguridad Perimetral):
# Resource Policy que restringe el tráfico para que únicamente acepte peticiones
# que arriban desde Amazon CloudFront portando el secreto de origen (aws:Referer)
# además de la x-api-key inyectada por CloudFront. (aws:SourceArn no es poblado por CloudFront en orígenes HTTP).
data "aws_iam_policy_document" "apigw_cloudfront_only" {
  statement {
    sid    = "AllowInvokeFromCloudFrontOnly"
    effect = "Allow"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions   = ["execute-api:Invoke"]
    resources = ["${aws_api_gateway_rest_api.booking_api.execution_arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "aws:Referer"
      values   = ["https://cf-origin-guard.internal/${random_password.cloudfront_origin_secret.result}"]
    }
  }
}

resource "aws_api_gateway_rest_api_policy" "booking_api_policy" {
  rest_api_id = aws_api_gateway_rest_api.booking_api.id
  policy      = data.aws_iam_policy_document.apigw_cloudfront_only.json
}

# --- Cognito Authorizer ---
resource "aws_api_gateway_authorizer" "cognito" {
  name          = "booking-cognito-authorizer"
  type          = "COGNITO_USER_POOLS"
  rest_api_id   = aws_api_gateway_rest_api.booking_api.id
  provider_arns = [aws_cognito_user_pool.booking_pool.arn]
}

# --- Rutas Públicas (/public/{proxy+}) ---
resource "aws_api_gateway_resource" "public_root" {
  rest_api_id = aws_api_gateway_rest_api.booking_api.id
  parent_id   = aws_api_gateway_rest_api.booking_api.root_resource_id
  path_part   = "public"
}

resource "aws_api_gateway_resource" "public_proxy" {
  rest_api_id = aws_api_gateway_rest_api.booking_api.id
  parent_id   = aws_api_gateway_resource.public_root.id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "public_any" {
  rest_api_id      = aws_api_gateway_rest_api.booking_api.id
  resource_id      = aws_api_gateway_resource.public_proxy.id
  http_method      = "ANY"
  authorization    = "NONE"
  api_key_required = true
}

resource "aws_api_gateway_integration" "public_any_integration" {
  rest_api_id             = aws_api_gateway_rest_api.booking_api.id
  resource_id             = aws_api_gateway_resource.public_proxy.id
  http_method             = aws_api_gateway_method.public_any.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.booking_api.invoke_arn
}

resource "aws_api_gateway_method" "public_options" {
  rest_api_id      = aws_api_gateway_rest_api.booking_api.id
  resource_id      = aws_api_gateway_resource.public_proxy.id
  http_method      = "OPTIONS"
  authorization    = "NONE"
  api_key_required = false
}

resource "aws_api_gateway_integration" "public_options_integration" {
  rest_api_id             = aws_api_gateway_rest_api.booking_api.id
  resource_id             = aws_api_gateway_resource.public_proxy.id
  http_method             = aws_api_gateway_method.public_options.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.booking_api.invoke_arn
}

# --- Rutas Protegidas por Cognito (/{proxy+}) ---
resource "aws_api_gateway_resource" "api_proxy" {
  rest_api_id = aws_api_gateway_rest_api.booking_api.id
  parent_id   = aws_api_gateway_rest_api.booking_api.root_resource_id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "proxy_any" {
  rest_api_id      = aws_api_gateway_rest_api.booking_api.id
  resource_id      = aws_api_gateway_resource.api_proxy.id
  http_method      = "ANY"
  authorization    = "COGNITO_USER_POOLS"
  authorizer_id    = aws_api_gateway_authorizer.cognito.id
  api_key_required = true
}

resource "aws_api_gateway_integration" "proxy_any_integration" {
  rest_api_id             = aws_api_gateway_rest_api.booking_api.id
  resource_id             = aws_api_gateway_resource.api_proxy.id
  http_method             = aws_api_gateway_method.proxy_any.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.booking_api.invoke_arn
}

resource "aws_api_gateway_method" "proxy_options" {
  rest_api_id      = aws_api_gateway_rest_api.booking_api.id
  resource_id      = aws_api_gateway_resource.api_proxy.id
  http_method      = "OPTIONS"
  authorization    = "NONE"
  api_key_required = false
}

resource "aws_api_gateway_integration" "proxy_options_integration" {
  rest_api_id             = aws_api_gateway_rest_api.booking_api.id
  resource_id             = aws_api_gateway_resource.api_proxy.id
  http_method             = aws_api_gateway_method.proxy_options.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.booking_api.invoke_arn
}

resource "aws_lambda_permission" "apigw_invoke_booking_api" {
  statement_id  = "AllowAPIGatewayInvokeBookingApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.booking_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.booking_api.execution_arn}/*/*"
}

# --- Deployment, Stage y Usage Plan ---
resource "aws_api_gateway_deployment" "prod" {
  rest_api_id = aws_api_gateway_rest_api.booking_api.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.public_proxy.id,
      aws_api_gateway_method.public_any.id,
      aws_api_gateway_integration.public_any_integration.id,
      aws_api_gateway_resource.api_proxy.id,
      aws_api_gateway_method.proxy_any.id,
      aws_api_gateway_integration.proxy_any_integration.id,
      aws_api_gateway_rest_api_policy.booking_api_policy.id,
      data.aws_iam_policy_document.apigw_cloudfront_only.json
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "prod" {
  deployment_id = aws_api_gateway_deployment.prod.id
  rest_api_id   = aws_api_gateway_rest_api.booking_api.id
  stage_name    = "prod"
}

resource "aws_api_gateway_usage_plan" "booking_plan" {
  name = "booking-usage-plan"

  api_stages {
    api_id = aws_api_gateway_rest_api.booking_api.id
    stage  = aws_api_gateway_stage.prod.stage_name
  }

  throttle_settings {
    burst_limit = 100
    rate_limit  = 50
  }

  quota_settings {
    limit  = 25000
    period = "DAY"
  }
}

resource "aws_api_gateway_api_key" "booking_key" {
  name    = "booking-cloudfront-api-key"
  enabled = true
}

resource "aws_api_gateway_usage_plan_key" "main" {
  key_id        = aws_api_gateway_api_key.booking_key.id
  key_type      = "API_KEY"
  usage_plan_id = aws_api_gateway_usage_plan.booking_plan.id
}

