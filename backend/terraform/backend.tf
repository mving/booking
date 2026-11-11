terraform {
  backend "s3" {
    bucket       = "uade-qr-terraform-state-774343040549-us-east-1-an"
    key          = "booking/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
    encrypt      = true
  }
}

