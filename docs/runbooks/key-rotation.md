# Secret and key rotation

Application HMAC keys, the CloudFront origin secret, Cognito client secret, database passwords, KMS keys, and GitHub deploy trust have different consequences; do not rotate them as an undifferentiated batch.

- Rotating session or magic-link HMAC keys invalidates outstanding sessions/links. Schedule a maintenance window, deploy the new secret atomically, and communicate only that users may need a new link.
- Rotating the origin secret requires coordinated CloudFront and Lambda configuration. Apply both through Terraform and confirm direct API requests still fail.
- Database password rotation updates Secrets Manager, then invokes the migration role reconciler before application traffic. Verify Data API access with the application secret and remove any superseded secret version per policy.
- Cognito client-secret rotation requires a replacement app client or a coordinated in-place rotation. Validate password sign-in, temporary-password replacement, TOTP enrollment, returning-user TOTP, password reset, ID-token verification, and opaque-session issuance before removing the prior client.
- KMS automatic annual rotation is enabled. Key replacement is a migration: grant/read old ciphertext, re-encrypt each supported resource, prove restore/decrypt, then schedule old-key deletion with a 30-day window.
- A GitHub trust change is made in bootstrap Terraform and must retain the exact repository/environment `sub` restriction.

After any rotation, revoke old sessions where relevant, run fictional login/search/delete smoke tests, check alarms, and record only key aliases/versions and dates—not secret values.
