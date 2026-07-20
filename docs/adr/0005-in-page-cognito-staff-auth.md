# ADR 0005: In-page Cognito staff authentication

- Status: Accepted
- Date: 2026-07-17
- Last amended: 2026-07-19

## Context

The Cognito managed-login redirect moved staff from the Gifts in Service interface to an `amazoncognito.com` page for authentication. Although the authorization-code flow was secure, the different host and presentation made a routine staff journey feel disconnected from the application.

The production user pool requires TOTP and uses a confidential application client. Gifts in Service must continue to derive authorization from verified Cognito group claims, must not expose the client secret or Cognito tokens to browser code, and must not persist or log credentials or challenge material.

## Decision

The `/staff` React page owns the complete native Cognito user-pool experience: password sign-in, required permanent-password selection, TOTP enrollment, returning-user TOTP challenge, and password reset.

The same-origin staff Lambda uses Cognito's `ADMIN_USER_PASSWORD_AUTH` and admin challenge APIs. It holds the confidential app-client secret, sends credentials and challenge responses to Cognito only in request memory, and returns Cognito challenge state to the browser inside an authenticated-encrypted transaction with a 10–15 minute expiry. The transaction is kept in React memory and is not written to browser storage.

After Cognito authenticates the user, the Lambda verifies the ID-token signature, issuer, audience, token use, subject, and exact application groups. It then discards the Cognito token and issues the 24-hour opaque staff session defined by ADR 0003. Cognito access and ID token validity is also capped at 24 hours, although these tokens remain transient and are not used as the browser session. Strict Origin checks, endpoint rate limits, Cognito threat protection, TOTP, and existing CSRF/session controls remain mandatory.

The TOTP entry control submits automatically when it contains six digits. The explicit Continue button remains available for accessibility, correction, and non-scripted operation.

The Cognito hosted domain, OAuth callback configuration, and obsolete OAuth state table are removed.

## Consequences

Staff remain visually and navigationally inside Gifts in Service throughout native Cognito authentication. Passwords and TOTP codes pass through the staff Lambda transiently, increasing the importance of the existing no-body-logging rule and least-privilege access to runtime inspection.

This flow intentionally supports native user-pool accounts only. OIDC and SAML federation require user-agent redirects and therefore cannot meet the same-page constraint. Adding workforce federation requires a new design decision and user-experience review rather than silently reintroducing a hosted redirect.
