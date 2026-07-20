# Backup restore and purge replay

Production Aurora retains encrypted backups for 35 days. Restoration must never make previously deleted data visible.

1. Block user/staff traffic and leave the current cluster intact. Export the current `purge_events` journal and its cutoff time to an encrypted, access-restricted incident location; it contains only HMAC pseudonyms and dates.
2. Restore Aurora to a new cluster, enable the Data API, and do not connect application Lambdas yet.
3. Apply all repository migrations using the reviewed migration function/code.
4. For every restored `people.id`, compute the HMAC pseudonym with the production purge key. Delete every match in the exported journal whose purge occurred after the restore point. Cascades remove profile, embedding, contacts, sessions, tokens, lifecycle, and operational rows.
5. Re-run the replay until idempotently clean; compare counts and sample only fictional/UUID evidence. Never export names, emails, or profile prose for this check.
6. Verify backup age, key access, schema version, lifecycle clock, active-profile eligibility, SES configuration, alarms, and direct-origin rejection.
7. Switch the Data API cluster ARN only after two-person review and a deletion-replay sign-off. Retain the old cluster encrypted and blocked until the recovery is accepted, then destroy it according to the incident plan.

If the purge journal cannot be obtained or reconciled, keep the restored environment blocked. Restore a newer recovery point containing the journal or wait for affected backups to expire; do not guess that deletion is complete.
