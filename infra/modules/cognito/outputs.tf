output "user_pool_id" { value = aws_cognito_user_pool.staff.id }
output "client_id" { value = aws_cognito_user_pool_client.staff.id }
output "client_secret" {
  value     = aws_cognito_user_pool_client.staff.client_secret
  sensitive = true
}
