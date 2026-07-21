# ADR 0004: Resumable pending interviews

- Status: Accepted
- Date: 2026-07-16
- Supersedes: ADR 0001's stateless-interview decision

## Context

Keeping an unfinished interview only in one browser tab caused work to be lost on refresh, session expiry, or use of a newly requested magic link. Members may reasonably need several days to finish an interview.

## Decision

Store one pending interview per person in encrypted Aurora PostgreSQL. The row contains the displayed questions and member answers, the latest unapproved proposal when one exists, a broad `LOW`/`MODERATE`/`HIGH` completeness-confidence value used only to continue adaptive questioning, an optimistic revision, and timestamps. It is accessible only through a valid member session selected for that person; it is never exposed to staff routes, staff search, embeddings, analytics, application logs, traces, or audit records. Specific model-reported coverage gaps are not persisted.

The retention clock starts when the interview is first opened and expires exactly 30 days later. Refreshing the page, redeeming another magic link, or sending more answers does not extend it. Approval deletes the pending row in the same database transaction that saves the approved profile. Person deletion cascades to it, and the lifecycle worker removes expired rows. Encrypted backups can contain inaccessible copies until their normal rotation.

Member interview writes use an optimistic revision so two tabs cannot silently overwrite each other. The server, not the browser, supplies the authoritative transcript and prior completeness value to each stateless Bedrock call and supplies the transcript to profile drafting. Browser storage remains prohibited. Confidence is conversation-control state, not a measure of the person's value or suitability, and is deleted with the pending interview.

## Consequences

Members can resume an interview through a refreshed page or new magic link. The application now retains sensitive unapproved prose temporarily, increasing the importance of narrow application-role access, no-body logging, KMS encryption, expiry monitoring, and accurate privacy disclosure. Only approved profile prose remains searchable or visible to authorized staff.
