# Lifecycle operations

EventBridge invokes the lifecycle Lambda daily. Dates derive from `last_verified_at`:

- week 52: reminder;
- weeks 54 and 56: follow-up reminders;
- week 58: mark stale/inactive and schedule purge;
- week 62: idempotent purge.

Each reminder creates one person-bound link per deliverable verified email. A successful confirmation invalidates the verification cycle's other links. `lifecycle_events` uniqueness makes retries safe.

Review the dashboard, Lambda error alarm, deliverability state, and lifecycle exception view weekly. For a failed run, correct the dependency and invoke the function again; do not update lifecycle timestamps manually. For an approved exception, use the admin control, provide a non-sensitive reason, and review its audit event. Never extend a profile to hide an email failure without confirming the person through an authorized channel.

Before changing intervals, update lifecycle calculations, UI/policy wording, tests, Terraform schedules if needed, and this runbook. Member deletion always takes precedence over lifecycle processing.
