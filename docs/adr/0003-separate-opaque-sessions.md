# ADR 0003: Separate opaque member and staff sessions

- Status: Accepted; staff upstream flow superseded in part by ADR 0005
- Date: 2026-07-15
- Last amended: 2026-07-19

## Decision

Members authenticate by single-use, fragment-delivered magic links. Staff authenticate through Cognito; [ADR 0005](0005-in-page-cognito-staff-auth.md) replaces the original authorization-code redirect with a same-page, server-side Cognito challenge flow. Each flow exchanges upstream proof for a separate opaque server-side session whose token is stored only as a keyed hash and sent in a host-only Secure/HttpOnly cookie. State changes require strict Origin checks and a CSRF header. Cognito tokens are discarded after session creation.

This keeps mailbox identity separate from workforce authorization and ensures UI visibility is never an authorization boundary.

Member sessions have a fixed 30-day absolute lifetime after magic-link redemption so a member can complete a pending interview over multiple visits. The server reissues the same opaque cookie only for the remaining portion of that fixed lifetime; activity and additional requests do not extend it. Staff sessions have a fixed 24-hour absolute lifetime so routine staff use requires no more than daily reauthentication. Staff sign-out, account administration, and incident-response controls can revoke them sooner.
