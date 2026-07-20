output "api_endpoint" { value = var.api_endpoint }
output "function_arns" { value = { for key, fn in aws_lambda_function.function : key => fn.arn } }
output "function_names" { value = { for key, fn in aws_lambda_function.function : key => fn.function_name } }
output "function_role_names" { value = { for key, role in aws_iam_role.function : key => role.name } }
