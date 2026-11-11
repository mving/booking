output "api_url" {
  description = "URL base del API Gateway"
  value       = aws_api_gateway_stage.prod.invoke_url
}

output "api_key_id" {
  description = "ID de la API Key generada"
  value       = aws_api_gateway_api_key.booking_key.id
}

output "api_key_value" {
  description = "Valor de la API Key generada (sensible)"
  value       = aws_api_gateway_api_key.booking_key.value
  sensitive   = true
}

output "cognito_user_pool_id" {
  description = "ID del User Pool de Cognito"
  value       = aws_cognito_user_pool.booking_pool.id
}

output "cognito_client_id" {
  description = "ID del App Client de Cognito"
  value       = aws_cognito_user_pool_client.booking_client.id
}

output "cognito_domain" {
  description = "Dominio de Cognito para Google SSO"
  value       = "${aws_cognito_user_pool_domain.main.domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "frontend_s3_bucket" {
  description = "Bucket S3 donde se aloja la SPA"
  value       = aws_s3_bucket.frontend_bucket.id
}

output "frontend_cloudfront_url" {
  description = "URL HTTPS de la distribución de CloudFront"
  value       = "https://${aws_cloudfront_distribution.frontend_distribution.domain_name}"
}

output "frontend_cloudfront_id" {
  description = "ID de la distribución de CloudFront"
  value       = aws_cloudfront_distribution.frontend_distribution.id
}

