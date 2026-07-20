# SES and email deliverability

Before traffic, verify the sender/domain, DKIM, MAIL FROM posture if configured, production access, configuration set, TLS requirement, account suppression, and that a fictional send produces SNS → encrypted SQS → email-worker processing.

The Lambda send policy keeps the From address exact and the configuration-set ARN exact. Its SES identity resource uses the account-scoped identity pattern because sandbox sends additionally authorize each verified recipient identity; narrowing that resource to only the sender domain causes real verified recipients to fail with `AccessDeniedException` even though the mailbox simulator succeeds. Do not remove the exact `ses:FromAddress` condition when changing this policy.

Bounce/complaint events update the matching verified email's deliverability state and insert an idempotent event. Permanent bounces become hard bounces; complaints are not retried. Review the SES reputation dashboard and both email queue/DLQ alarms. Redrive only after fixing the cause and confirming the event shape with synthetic data.

Do not remove the last verified email merely to clear a bounce; the database forbids it. Do not work around SES suppression. Help the person verify another deliverable address, then make it primary and remove the old association if requested.

During an incident, pause outbound sends by disabling the SES configuration set or its IAM path, preserve message IDs/outcomes without addresses, and follow [incident response](incident-response.md).
