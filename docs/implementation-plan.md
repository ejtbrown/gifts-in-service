# Implementation plan

Last updated: 2026-07-18

This checklist is the execution record for the initial Gifts in Service MVP. Checked items have code or documentation in this repository; external prerequisites remain explicitly unchecked.

## Milestone 1 — foundation

- [x] Inspect repository and preserve existing material.
- [x] Add durable repository guidance in `AGENTS.md`.
- [x] Establish a pinned Node/pnpm TypeScript workspace.
- [x] Record architecture and privacy decisions in ADRs.
- [x] Keep this checklist synchronized through final validation.

## Milestone 2 — privacy-safe domain and data layer

- [x] Add versioned disclosures and AI prompts.
- [x] Add schemas, permissions, lifecycle calculations, hashing, CSRF, audit redaction, RRF, and evidence validation.
- [x] Add PostgreSQL migrations with pgvector/full-text indexes and invariants.
- [x] Add Data API and direct PostgreSQL executor implementations.
- [x] Add fictional seed profiles and hybrid retrieval.

## Milestone 3 — working local application

- [x] Implement neutral magic-link request, fragment redemption, mailbox selection, and secure member sessions.
- [x] Implement in-memory interview, draft review, hash-bound approval, profile management, email verification, and deletion.
- [x] Implement fake Bedrock/SES/Cognito adapters for a credential-free demo.
- [x] Implement staff auth/authorization, grounded hybrid search, profile/contact audit, lifecycle/admin/audit/health views.
- [x] Replace the hosted Cognito redirect with same-page password, TOTP enrollment/challenge, and password-reset flows.
- [x] Add MFA autofocus, resilient search-planner fallback, and a permission-driven staff operations console.
- [x] Expose volunteer status/deletion, lifecycle exceptions, and lower-privilege staff invite/role/session/disable/enable/delete controls.
- [x] Bound staff search reranking and responses to the top 10 fused candidates.
- [x] Implement accessible React member/staff journeys with no third-party assets or trackers.

## Milestone 4 — lifecycle, operations, and tests

- [x] Implement 52/54/56/58/62-week lifecycle and idempotent cleanup/purge.
- [x] Add unit, PostgreSQL integration, Playwright E2E, accessibility, security, and deterministic AI evaluation coverage.
- [x] Add Docker Compose for pgvector and Mailpit.
- [x] Add sanitized metrics/logging and operational runbooks.

## Milestone 5 — AWS and delivery

- [x] Add Terraform bootstrap with encrypted/versioned S3 state and native lockfiles.
- [x] Add reusable AWS modules and secure dev/prod roots.
- [x] Provision CloudFront/private S3/WAF/API/Lambda, Aurora/Data API, Cognito/TOTP groups, Bedrock guardrail, SES events, Scheduler/SQS, alarms, and budget.
- [x] Standardize Aurora on PostgreSQL 17.7 LTS and enforce an engine-support horizon during deployment.
- [x] Add production privacy/SES/model preflight and custom-domain/federation structure.
- [x] Add GitHub OIDC CI/CD, immutable action pins, Dependabot, CODEOWNERS, and templates.

## Milestone 6 — validation and handoff

- [x] `pnpm format:check`
- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] `pnpm eval:ai`
- [x] `pnpm test:integration`
- [x] `pnpm test:e2e`
- [x] `pnpm test:a11y`
- [x] `pnpm build`
- [x] `pnpm build:lambdas`
- [x] `pnpm audit:dependencies`
- [x] `pnpm audit:repo`
- [x] `pnpm infra:fmt`
- [x] `pnpm infra:validate`
- [x] Review repository files for secrets and real personal data.

## External prerequisites (do not mark complete in code)

- [ ] AWS account/region and one-time bootstrap authority.
- [ ] Bedrock model access plus confirmed retention/invocation-logging posture.
- [ ] Verified SES identity and SES production access.
- [ ] Actual GitHub repository/environment settings and bootstrap admin identity.
- [ ] Church name, contacts, branding, and legal review by Texas counsel.
- [ ] Future domain/DNS and workforce federation metadata/MFA assurance.
