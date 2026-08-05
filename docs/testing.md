# Testing strategy

- Unit tests cover token entropy/hashes, Origin/CSRF, permission matrix, Cognito device-SRP vectors and device administration, lifecycle dates, rank fusion, evidence grounding, safety detection, log sanitization, and migration parsing.
- PostgreSQL integration tests run real migrations against PostgreSQL 17 + pgvector and cover database invariants, the magic-link/profile approval API path, trusted-browser enrollment/use/expiry/tampering/subject mismatch/revocation, lifecycle reminders/staleness/purge, search inputs, and immediate deletion.
- Playwright covers accessible landing/disclosure, token fragment removal, pending-interview resume after refresh and a new magic link, no browser persistence, and inert untrusted content. Axe runs on public and staff-facing pages.
- Deterministic AI evaluations cover balanced branching, established-fact memory across longer conversations, stale-note removal, repeated-question suppression, “already answered” and user-directed wrap-up controls, optional follow-ups, interview completeness, post-proposal additions, conversational deletion routing, discovery breadth, boundaries, prohibited-data redirection, self-reported caveats, evidence grounding, and prompt injection. Live Bedrock evaluation is manual and fictional-only.
- Terraform validation initializes bootstrap/dev/prod without a backend. Repository scanning rejects common credentials, forbidden browser stores/raw HTML, and likely body logging.

The full command set is in `README.md`. Any new authorization, lifecycle state, data store, prompt, or deletion path needs positive and negative tests. Never use real people, addresses, interview text, or production tokens in fixtures or snapshots.
