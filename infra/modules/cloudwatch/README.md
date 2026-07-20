# CloudWatch module compatibility note

CloudWatch dashboards and alarms are implemented in `modules/observability` to avoid circular outputs between Lambda, queues, and alarms.
