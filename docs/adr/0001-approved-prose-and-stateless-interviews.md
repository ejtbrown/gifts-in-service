# ADR 0001: Approved prose and stateless interviews

- Status: Superseded by ADR 0004
- Date: 2026-07-15

## Context

An open-ended interview is useful for discovering abilities, but retaining it creates needless privacy risk and hidden derived records can become an unreviewable skills system.

## Decision

Interview messages exist only in the browser's in-memory React state and are supplied to a stateless model call. The application never logs or stores them. A profile draft is bound to a short-lived approval nonce and the SHA-256 hash of its exact displayed text. Only after explicit approval are the exact prose, its embedding, consent/lifecycle metadata, identity associations, and narrow audit/security records stored. No hidden skill taxonomy or historical prose is retained.

## Consequences

Refreshing a page loses an unfinished interview. Updates start from the current approved prose. Model and infrastructure retention/logging require a fail-closed production preflight.
