# Repository instructions

## Layout

- `apps/web`: React/Vite browser application. Pending interview messages are resumed from the authenticated API and must not use browser persistence.
- `services/*`: independently deployable Lambda entry points and the local API host.
- `packages/shared`: versioned disclosures, schemas, configuration, permissions, and pure domain logic.
- `packages/auth`, `packages/ai`, `packages/db`, `packages/email`: security and external-service boundaries.
- `migrations`: ordered, idempotent PostgreSQL migrations. Do not use an ORM for search SQL.
- `infra`: Terraform bootstrap, reusable modules, and `dev`/`prod` roots.
- `docs`: architecture, ADRs, privacy/security material, and operational runbooks.
- `tests`: cross-package integration, E2E, accessibility, and security tests.

## Commands

Use Node.js 24 and the pnpm version pinned in `package.json`.

- `pnpm install --frozen-lockfile`
- `pnpm dev` / `pnpm build`
- `pnpm format:check` / `pnpm lint` / `pnpm typecheck`
- `pnpm test` / `pnpm test:integration` / `pnpm test:e2e` / `pnpm test:a11y`
- `pnpm db:migrate` / `pnpm db:seed`
- `pnpm eval:ai`
- `pnpm infra:fmt` / `pnpm infra:validate`

## Conventions

- TypeScript is strict. Validate every trust boundary with Zod and use parameterized SQL.
- Keep AWS integrations behind small interfaces with deterministic local fakes.
- Store UTC timestamps; render user-facing dates in `America/Chicago`.
- Logs contain correlation ID, route, status, duration, and error class only.
- Add an ADR for material, long-lived design decisions.
- Use clearly fictional names and addresses in all examples and fixtures.

## Security and privacy constraints

- Pending interview transcripts may be persisted only in `pending_interviews`, scoped to the owning person, with a fixed 30-day expiry. Never log them, expose them to staff search, or retain them after profile approval or person deletion.
- The exact approved prose is authoritative. Embed only that prose; never names, email, audit data, or hidden tags.
- Never store raw tokens or sessions; store keyed hashes. Magic tokens belong in URL fragments and are redeemed by POST.
- Do not put credentials, real personal data, raw IPs, OAuth codes, cookies, request bodies, or staff queries in infrastructure logs.
- Render profile/model content as text, never HTML. Do not use `dangerouslySetInnerHTML`.
- Enforce authorization, Origin, CSRF, eligibility, and ownership in backend code even when the UI hides an action.
- A privacy-critical production preflight failure must stop deployment.

## Testing and definition of done

- Add unit tests for domain/security logic and regression tests for each fixed defect.
- Database behavior must be covered against PostgreSQL with pgvector; external AI/email/auth calls use fakes in CI.
- Run formatting, lint, type checking, unit, integration, E2E, accessibility, build, and Terraform checks before handoff.
- A change is done only when behavior, tests, documentation, configuration validation, and privacy/security effects agree.
