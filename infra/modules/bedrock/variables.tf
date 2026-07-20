variable "prefix" { type = string }
variable "tags" { type = map(string) }
variable "kms_key_arn" { type = string }
variable "interview_model_id" { type = string }
variable "search_model_id" { type = string }
variable "embedding_model_id" { type = string }
variable "embedding_dimension" {
  type = number
  validation {
    condition     = contains([256, 512, 1024], var.embedding_dimension)
    error_message = "Titan Text Embeddings v2 dimension must be 256, 512, or 1024"
  }
}
