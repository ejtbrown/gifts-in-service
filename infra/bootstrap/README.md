# Terraform bootstrap

Run this root once with an AWS-authorized operator. It creates a versioned, KMS-encrypted S3 backend using Terraform's native `use_lockfile` state locking and GitHub OIDC roles bound to the exact repository and protected `dev`/`prod` GitHub Environments.

```bash
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap apply -var='github_repository=owner/gifts-in-service'
terraform -chdir=infra/bootstrap output -json
```

Use the emitted environment-specific `backend_init_commands`, then move any pre-existing local state with `terraform init -migrate-state`. Do not copy state through logs or pull-request artifacts. The deploy policy lists only services in the current Terraform surface; review it and apply an organization permission boundary/SCP appropriate to the target account.

If the account already has the GitHub OIDC provider, set `create_github_oidc_provider=false`. GitHub environments and branch protection are external configuration; create and protect them before trusting the roles.
