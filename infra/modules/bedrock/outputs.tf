output "guardrail_id" { value = aws_bedrock_guardrail.privacy.guardrail_id }
output "guardrail_version" { value = aws_bedrock_guardrail_version.privacy.version }
output "model_configuration" {
  value = {
    interview_model_id  = var.interview_model_id
    search_model_id     = var.search_model_id
    embedding_model_id  = var.embedding_model_id
    embedding_dimension = var.embedding_dimension
  }
}
