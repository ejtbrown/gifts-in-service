# Staff access and federation

The local fake role chooser is a development adapter and production configuration rejects it. Production uses the application-owned `/staff` page for Cognito-native email/password authentication and mandatory TOTP. Sign-in, temporary-password replacement, TOTP enrollment, TOTP verification, and password reset remain on the same page. The browser never receives the Cognito client secret or final Cognito token, and the application does not store or log passwords or verification codes.

The exact groups are `gis-admin`, `gis-staff`, `gis-ministry-leader`, `gis-privacy-auditor`, and `gis-technical-admin`. Bootstrap the first administrator with AWS CLI/console using a reviewed church address, add only `gis-admin`, and issue a temporary password through an approved channel. On first sign-in, verify that `/staff` prompts for a permanent password and TOTP enrollment without loading or navigating to an `amazoncognito.com` host. Use separate named accounts; never share an admin login. Assign the smallest groups needed and review group membership quarterly. Disabling a user should include Cognito global sign-out and server staff-session cleanup.

The application staff console exposes only controls granted by the signed-in
user's effective permissions:

| Group                 | Visible controls                                                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gis-admin`           | Search and profile contact view; all volunteer records; pause, reactivate, and permanent deletion; lifecycle delivery exceptions; privacy audit; lower-privilege staff access |
| `gis-staff`           | Search and active-profile/contact view                                                                                                                                        |
| `gis-ministry-leader` | Search and active-profile/contact view                                                                                                                                        |
| `gis-privacy-auditor` | PII-minimized privacy and lifecycle audit only                                                                                                                                |
| `gis-technical-admin` | Non-PII technical health only                                                                                                                                                 |

Administrators may invite native users directly into one or more of the three
lower-privilege groups, update those group memberships, revoke sessions,
disable and re-enable accounts, and permanently delete accounts. The UI and API
both prevent an administrator from deleting or disabling their own account.
Accounts in `gis-admin` or `gis-technical-admin` are read-only in the
application console; create, change, disable, or delete them only through the
reviewed AWS-authorized process. Permanent deletion is appropriate only after
the church has confirmed that the account should not be retained in a disabled
state. Every access mutation is written to the privacy-safe audit log.

Volunteer record controls are similarly permission-enforced by the API. Pausing
a profile immediately removes it from search but retains it for correction or
reactivation. Permanent deletion removes the live person, approved profile,
embedding, email associations, member sessions, and pending records and cannot
be undone from the console.

The in-page Cognito API flow supports native user-pool accounts only. OIDC and SAML providers require browser redirects by protocol and are not configured by this stack. A future federation change needs a separate ADR and UX decision, metadata and secrets outside source control, immutable subject/group mapping, equivalent MFA assurance, duplicate-subject tests, and a rollback window. Do not use email alone as the durable staff identity. Audit every administrative group change.
