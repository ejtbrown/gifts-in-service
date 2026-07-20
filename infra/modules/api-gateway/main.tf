resource "aws_apigatewayv2_api" "this" {
  name                         = "${var.prefix}-http"
  protocol_type                = "HTTP"
  disable_execute_api_endpoint = false
  tags                         = var.tags
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }
  tags = var.tags
}
