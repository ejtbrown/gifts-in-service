# Initial deployment

## 1. Bootstrap once

Use a separately authorized AWS operator, Terraform 1.14.x, and the intended region:

```bash
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap apply -var='github_repository=OWNER/REPOSITORY'
terraform -chdir=infra/bootstrap output
```

Record the state bucket, state KMS ARN, exact dev/prod deploy role ARNs, and read-only plan role ARN in protected GitHub Environment variables. The OIDC trust is restricted to the exact repository and `dev`, `prod`, or `dev-plan` environment; no long-lived AWS keys are used.

## 2. Configure protected environments

Require reviewers for `prod`. Set `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION`, `TF_STATE_BUCKET`, `TF_STATE_KMS_KEY_ARN`, `CHURCH_DISPLAY_NAME`, `PRIVACY_CONTACT_EMAIL`, `HELP_CONTACT_EMAIL`, `SES_SENDER_EMAIL`, `SES_SENDER_DOMAIN`, and `BUDGET_ALERT_EMAIL` in both deploy environments. Optional values are `CUSTOM_DOMAIN_NAME` and `ROUTE53_ZONE_ID`. Configure `AWS_PLAN_ROLE_ARN` plus the non-secret dev values in the protected `dev-plan` environment.

For a domain identity already managed outside this stack, set `SES_USE_DOMAIN_IDENTITY=true` and `SES_MANAGE_SENDER_IDENTITY=false`. The application then authorizes the exact `SES_SENDER_EMAIL` under that domain without importing, replacing, or changing the existing SES identity. Leave `SES_MANAGE_SENDER_IDENTITY=true` when this stack should create and own the identity.

After legal/operational review, set `BEDROCK_ZERO_RETENTION_CONFIRMED`, `BEDROCK_INVOCATION_LOGGING_REVIEWED`, `BODY_LOGGING_DISABLED_CONFIRMED`, `SES_PRODUCTION_READY`, and `POLICY_COPY_REVIEWED` to the exact string `true`. These are attestations, not inferred defaults. Complete [the checklist](../preflight-checklist.md).

## 3. Validate and deploy

Run CI locally or wait for a green protected commit:

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm eval:ai
pnpm build && pnpm build:lambdas
pnpm infra:validate
```

Use the manual Deploy workflow. It assumes the environment-specific OIDC role, reruns checks, fails closed on production preflight, applies Terraform with an encrypted native-lockfile backend, invokes the migration Lambda, syncs the web build to private S3 with KMS encryption, and invalidates CloudFront.

The deployment preflight reads `infra/database-release.json`, requires at least one year of remaining standard support, and verifies through the regional RDS API that the selected Aurora PostgreSQL engine reports `available`. Aurora 17.7 is deliberately pinned as an LTS release; automatic minor upgrades are disabled so AWS does not move the cluster away from that LTS line without a reviewed configuration change.

For a controlled command-line deployment, use the backend command emitted by bootstrap, apply the environment root, invoke `gis-ENV-migration`, then upload `apps/web/dist` to the Terraform `frontend_bucket` output and invalidate `distribution_id`.

## 4. Bootstrap staff and smoke test

Create the first Cognito user with a reviewed church address outside source control, add it to `gis-admin`, require TOTP enrollment, and verify that password replacement and TOTP setup complete on `/staff` without a hosted Cognito redirect. Never use the local fake staff endpoint in AWS. Follow [staff access](staff-access.md).

With clearly fictional data, verify magic-link delivery, fragment removal, new profile approval, staff search with supported evidence, pause/search exclusion, reactivation, member deletion, SES feedback, queue depth, alarms, and dashboard. Confirm the direct API endpoint rejects requests without the CloudFront origin header.

Do not enable production traffic if migration output, smoke tests, retention/logging review, SES feedback, or TOTP setup is incomplete.
