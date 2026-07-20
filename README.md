# Gifts in Service

Gifts in Service is a deployable, privacy-minded MVP for helping authorized church staff find adults who have self-reported abilities and willingness to help. A member privately interviews with an AI assistant, approves the exact prose retained about them, and can later update, pause, reconfirm, or delete it. Staff search active profiles with grounded hybrid retrieval; this is not credential verification or automatic assignment.

Policy copy and example branding are drafts requiring church and Texas legal review. All included people and addresses are fictional.

## Local demo

Prerequisites: Node.js 24, pnpm 11.13.1, Docker, and Docker Compose.

```bash
cp .env.example .env
docker compose up -d
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open `http://127.0.0.1:5173`; Mailpit is at `http://127.0.0.1:8025`. Local AI, email, and staff authentication adapters require no AWS credentials. Unfinished interview questions and answers are stored server-side for up to 30 days and resume after a refresh or newly redeemed magic link.

The fake staff sign-in exposes explicit fictional roles for testing. It is never enabled by the production configuration schema.

## Validation

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:a11y
pnpm build
pnpm build:lambdas
pnpm infra:fmt
pnpm infra:validate
pnpm audit:repo
pnpm audit:dependencies
```

`pnpm eval:ai` is deterministic by default. Set the documented live-evaluation variables only for a deliberate manual Bedrock evaluation; CI never needs AWS credentials.

## AWS deployment

Read [the preflight checklist](docs/preflight-checklist.md) and [initial deployment runbook](docs/runbooks/initial-deployment.md). In summary: bootstrap the encrypted remote-state bucket and GitHub OIDC role, supply reviewed environment variables through a protected GitHub Environment, run the fail-closed production preflight, apply Terraform, migrate the database with the migration role, upload the frontend, and smoke-test the CloudFront URL.

`main` deploys dev through its protected environment; production is manual/approved. Same-repository infrastructure PRs use the separate `dev-plan` environment and read-only state role with refresh disabled. See [repository governance](docs/repository-governance.md).

No custom domain is required initially. Terraform outputs the CloudFront URL and supports a later ACM/Route 53 cutover.

## Important limits

- Qualifications are self-reported; separate screening, licensing, safeguarding, and professional verification remain church responsibilities.
- AWS account access, Bedrock retention/logging confirmation and model access, SES verification/production approval, actual church branding/contacts, a bootstrap administrator, legal review, GitHub environment protection, future DNS, and future workforce IdP metadata are external prerequisites.
- Deleted live data can remain in encrypted backups until their configured rotation (35 days in production); restore procedures replay post-backup purge events before access.
