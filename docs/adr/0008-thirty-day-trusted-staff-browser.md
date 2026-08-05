# ADR 0008: Thirty-day trusted staff browser

- Status: Accepted
- Date: 2026-08-05

## Context

Staff authentication requires a password and TOTP. The application's opaque staff session expires after 24 hours, so a staff member otherwise repeats both factors each day even on a private browser. Cognito supports opt-in remembered devices: a device SRP proof can replace the TOTP challenge on that Cognito sign-in, while the password remains mandatory.

The feature must not extend authorization, turn a browser into a bearer of a long-lived staff session, use fingerprinting, expose Cognito tokens or device secrets to JavaScript, or weaken revocation when a staff account changes.

## Decision

After completing TOTP setup or a returning-user TOTP challenge, staff may leave an unchecked **Trust this browser for 30 days** box selected. The choice is scoped to the current browser profile, not to physical hardware. Shared or public devices must not be trusted.

The application uses Cognito's opt-in remembered-device protocol. It confirms and marks the Cognito device remembered only after successful password and TOTP authentication. On later sign-ins, the staff Lambda sends the device SRP proof to Cognito after the password step. Cognito can then omit TOTP; it still verifies the password and the application still verifies the final ID token and exact groups before creating a new 24-hour opaque staff session.

The browser receives only a random opaque `__Host-gis_staff_trusted_browser` cookie with `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, and a fixed 30-day lifetime. It is not accessible to application JavaScript and is not placed in local storage. Aurora stores only its keyed hash plus the Cognito subject, username, normalized login identifier, device key/group, authenticated-encrypted device credentials, and fixed created/used/expiry/revocation timestamps. The credentials use a domain-separated application key, never appear in logs or audits, and are deleted after expiry or revocation. A subject may have at most five active trusted browsers.

Local state is authoritative. An expired, revoked, unknown, malformed, tampered, or subject-mismatched browser credential is rejected or falls back to ordinary TOTP and is cleared. Rejection by Cognito also revokes the local device. The application best-effort forgets the corresponding Cognito device after local revocation; remote cleanup failure cannot preserve application trust without the locally stored encrypted credential.

Ordinary sign-out revokes the current 24-hour session but deliberately retains browser trust. **Forget this browser** revokes both and signs out. Password reset, staff-session administrative revocation, group change, disablement, and deletion revoke all known trusted browsers for the account. Group claims are checked on every sign-in, including trusted-device sign-in. Enrollment and revocation audits contain subjects and counts only, never cookies, device secrets, passwords, TOTP codes, or Cognito tokens.

## Consequences

A private browser can avoid repeated TOTP prompts for up to 30 days, but a new 24-hour staff session still requires the account password and a fresh successful Cognito authentication. Cookie theft plus the staff password can temporarily replace possession of the TOTP authenticator, so the user-facing warning, fixed expiry, five-device cap, secure host-only cookie, role checks, explicit revocation, and incident procedures remain required.

The server implements Cognito device SRP and stores encrypted device credentials because the browser is intentionally not a Cognito client. The deterministic SRP vectors, integration tests for expiry/tampering/subject mismatch, Cognito-device configuration, and least-privilege permissions are security-critical regression coverage.
