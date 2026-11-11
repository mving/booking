data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda_execution_role" {
  name               = "booking-lambda-execution-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role       = aws_iam_role.lambda_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "lambda_dynamodb_policy" {
  statement {
    effect = "Allow"
    actions = [
      "dynamodb:PutItem",
      "dynamodb:GetItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Scan",
      "dynamodb:Query",
      "dynamodb:BatchWriteItem",
      "dynamodb:TransactWriteItems"
    ]
    resources = [
      aws_dynamodb_table.booking_buildings.arn,
      "${aws_dynamodb_table.booking_buildings.arn}/index/*",
      aws_dynamodb_table.booking_users.arn,
      "${aws_dynamodb_table.booking_users.arn}/index/*",
      aws_dynamodb_table.booking_amenities.arn,
      "${aws_dynamodb_table.booking_amenities.arn}/index/*",
      aws_dynamodb_table.booking_reservations.arn,
      "${aws_dynamodb_table.booking_reservations.arn}/index/*"
    ]
  }

  statement {
    effect = "Allow"
    actions = [
      "dynamodb:GetRecords",
      "dynamodb:GetShardIterator",
      "dynamodb:DescribeStream",
      "dynamodb:ListStreams"
    ]
    resources = [
      aws_dynamodb_table.booking_users.stream_arn
    ]
  }
}

resource "aws_iam_policy" "lambda_dynamodb_access" {
  name        = "booking-lambda-dynamodb-access"
  description = "Permite a las funciones Lambda operar sobre las tablas DynamoDB del sistema de reservas"
  policy      = data.aws_iam_policy_document.lambda_dynamodb_policy.json
}

resource "aws_iam_role_policy_attachment" "lambda_dynamodb_attach" {
  role       = aws_iam_role.lambda_execution_role.name
  policy_arn = aws_iam_policy.lambda_dynamodb_access.arn
}

data "aws_iam_policy_document" "lambda_cognito_policy" {
  statement {
    effect = "Allow"
    actions = [
      "cognito-idp:ListUsers",
      "cognito-idp:AdminGetUser",
      "cognito-idp:AdminDisableUser",
      "cognito-idp:AdminEnableUser",
      "cognito-idp:AdminDeleteUser",
      "cognito-idp:AdminUserGlobalSignOut"
    ]
    resources = [
      aws_cognito_user_pool.booking_pool.arn
    ]
  }
}

resource "aws_iam_policy" "lambda_cognito_access" {
  name        = "booking-lambda-cognito-access"
  description = "Permite gestionar bajas, reactivaciones y eliminaciones definitivas en Cognito"
  policy      = data.aws_iam_policy_document.lambda_cognito_policy.json
}

resource "aws_iam_role_policy_attachment" "lambda_cognito_attach" {
  role       = aws_iam_role.lambda_execution_role.name
  policy_arn = aws_iam_policy.lambda_cognito_access.arn
}

