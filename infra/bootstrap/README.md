# Terraform bootstrap

Run this root once with an AWS-authorized operator. It creates a versioned, KMS-encrypted S3 backend using Terraform's native `use_lockfile` state locking and GitHub OIDC roles bound to the exact repository and protected `dev`/`prod` GitHub Environments.

```bash
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap apply \
  -var='github_repository=owner/gifts-in-service' \
  -var='github_repository_ids={"owner_id":"123456","repository_id":"789012"}'
terraform -chdir=infra/bootstrap output -json
```

GitHub repositories created after July 15, 2026 use immutable OIDC subjects.
Read the required IDs with
`gh api repos/owner/gifts-in-service --jq '{owner_id:.owner.id,repository_id:.id}'`.
For an older repository that still emits the legacy name-only subject, omit
`github_repository_ids`. Confirm the emitted subject in CloudTrail before
changing an existing trust.

Use the emitted environment-specific `backend_init_commands`, then move any pre-existing local state with `terraform init -migrate-state`. Do not copy state through logs or pull-request artifacts. The deploy policy lists only services in the current Terraform surface; review it and apply an organization permission boundary/SCP appropriate to the target account.

If the account already has the GitHub OIDC provider, set `create_github_oidc_provider=false`. GitHub environments and branch protection are external configuration; create and protect them before trusting the roles.
