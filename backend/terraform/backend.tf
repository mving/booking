terraform {
  backend "s3" {
    # El nombre del bucket se inyecta dinámicamente desde GitHub Actions
    # mediante terraform init -backend-config="bucket=uade-qr-terraform-state-<ACCOUNT_ID>-us-east-1-an"
    # Se utiliza una key aislada ("booking/terraform.tfstate") para no colisionar con otros proyectos en la misma cuenta.
    key          = "booking/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
    encrypt      = true
  }
}

