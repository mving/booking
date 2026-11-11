locals {
  lambda_env_vars = {
    BUILDINGS_TABLE           = aws_dynamodb_table.booking_buildings.name
    USERS_TABLE               = aws_dynamodb_table.booking_users.name
    AMENITIES_TABLE           = aws_dynamodb_table.booking_amenities.name
    RESERVATIONS_TABLE        = aws_dynamodb_table.booking_reservations.name
    REGISTRATION_TOKEN_SECRET = random_password.registration_token_secret.result
    INITIAL_GLOBAL_ADMIN      = var.initial_global_admin_email
  }
}

# --- 1. Lambda API Principal (Node.js 20.x con date-fns-tz) ---
data "archive_file" "api_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../functions/api"
  output_path = "${path.module}/../functions/api.zip"
}

resource "aws_lambda_function" "booking_api" {
  filename         = data.archive_file.api_zip.output_path
  function_name    = "booking-api-handler"
  role             = aws_iam_role.lambda_execution_role.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 15
  memory_size      = 256
  source_code_hash = data.archive_file.api_zip.output_base64sha256

  environment {
    variables = merge(local.lambda_env_vars, {
      USER_POOL_ID = aws_cognito_user_pool.booking_pool.id
    })
  }
}

# --- 2. Lambda Pre-SignUp Cognito (Bloquea emails con estado DEACTIVATED) ---
data "archive_file" "pre_signup_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../functions/pre_signup"
  output_path = "${path.module}/../functions/pre_signup.zip"
}

resource "aws_lambda_function" "pre_signup" {
  filename         = data.archive_file.pre_signup_zip.output_path
  function_name    = "booking-cognito-pre-signup"
  role             = aws_iam_role.lambda_execution_role.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 10
  source_code_hash = data.archive_file.pre_signup_zip.output_base64sha256

  environment {
    variables = {
      USERS_TABLE = aws_dynamodb_table.booking_users.name
    }
  }
}

# --- 3. Lambda Limpieza Definitiva Cognito tras expirar TTL de 1 año en DynamoDB ---
data "archive_file" "user_ttl_cleanup_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../functions/user_ttl_cleanup"
  output_path = "${path.module}/../functions/user_ttl_cleanup.zip"
}

resource "aws_lambda_function" "user_ttl_cleanup" {
  filename         = data.archive_file.user_ttl_cleanup_zip.output_path
  function_name    = "booking-user-ttl-cleanup"
  role             = aws_iam_role.lambda_execution_role.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 15
  source_code_hash = data.archive_file.user_ttl_cleanup_zip.output_base64sha256

  environment {
    variables = {
      USER_POOL_ID = aws_cognito_user_pool.booking_pool.id
    }
  }
}

resource "aws_lambda_event_source_mapping" "users_ttl_stream" {
  event_source_arn  = aws_dynamodb_table.booking_users.stream_arn
  function_name     = aws_lambda_function.user_ttl_cleanup.arn
  starting_position = "LATEST"
  batch_size        = 10

  filter_criteria {
    filter {
      pattern = jsonencode({
        eventName = ["REMOVE"]
      })
    }
  }
}

