# 1. Tabla de Edificios / Consorcios
resource "aws_dynamodb_table" "booking_buildings" {
  name         = "booking_buildings"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "building_id"

  attribute {
    name = "building_id"
    type = "S"
  }

  attribute {
    name = "slug"
    type = "S"
  }

  global_secondary_index {
    name            = "slug-index"
    hash_key        = "slug"
    projection_type = "ALL"
  }

  tags = {
    Name = "booking-buildings-table"
  }
}

# 2. Tabla de Usuarios por Edificio y Unidades Funcionales (con TTL de 1 año para dados de baja)
resource "aws_dynamodb_table" "booking_users" {
  name             = "booking_users"
  billing_mode     = "PAY_PER_REQUEST"
  hash_key         = "user_id"
  range_key        = "building_id"
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "user_id"
    type = "S"
  }

  attribute {
    name = "building_id"
    type = "S"
  }

  attribute {
    name = "unit_key"
    type = "S"
  }

  attribute {
    name = "email"
    type = "S"
  }

  global_secondary_index {
    name            = "building-unit-index"
    hash_key        = "building_id"
    range_key       = "unit_key"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "email-index"
    hash_key        = "email"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = {
    Name = "booking-users-table"
  }
}

# 3. Tabla de Amenities por Edificio
resource "aws_dynamodb_table" "booking_amenities" {
  name         = "booking_amenities"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "building_id"
  range_key    = "amenity_id"

  attribute {
    name = "building_id"
    type = "S"
  }

  attribute {
    name = "amenity_id"
    type = "S"
  }

  tags = {
    Name = "booking-amenities-table"
  }
}

# 4. Tabla de Reservas y Contadores Atómicos de Cupo (con TTL de 90 días)
resource "aws_dynamodb_table" "booking_reservations" {
  name         = "booking_reservations"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "building_id"
  range_key    = "reservation_sk"

  attribute {
    name = "building_id"
    type = "S"
  }

  attribute {
    name = "reservation_sk"
    type = "S"
  }

  attribute {
    name = "reservation_id"
    type = "S"
  }

  attribute {
    name = "user_id"
    type = "S"
  }

  attribute {
    name = "date"
    type = "S"
  }

  global_secondary_index {
    name            = "reservation-id-index"
    hash_key        = "reservation_id"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "user-reservations-index"
    hash_key        = "user_id"
    range_key       = "date"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = {
    Name = "booking-reservations-table"
  }
}

