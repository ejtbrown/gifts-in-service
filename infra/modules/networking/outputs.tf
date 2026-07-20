output "vpc_id" { value = aws_vpc.this.id }
output "database_subnet_ids" { value = aws_subnet.database[*].id }
