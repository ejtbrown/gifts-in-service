# Deployment rollback

1. Stop further deploys and preserve the failing workflow output without copying request bodies or personal data.
2. If the fault can expose or corrupt data, use WAF/CloudFront to block API traffic and revoke affected sessions before rollback.
3. Revert the faulty change through a pull request to the authoritative environment branch. CI rebuilds and tests the reverted commit before reconciling Terraform and publishing its artifacts.
4. For a frontend-only fault, restore the prior versioned S3 objects or sync the prior commit build, then invalidate `/*`.
5. Database migrations are forward-only. Do not hand-edit `schema_migrations`. Prefer a reviewed corrective migration. If restoration is unavoidable, use [backup restore](backup-restore.md) and replay purge records before access.
6. Smoke test member login, exact-text approval, staff authorization/search, lifecycle status, deletion, and alarms. Record the incident and corrective action.

Terraform state is versioned and locked, but rolling state backward does not roll AWS data back and should be an exceptional recovery operation with a reviewed resource inventory.
