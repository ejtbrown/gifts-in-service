# Cost and scaling posture

The dated repository model estimates one first-year production stack at approximately **$14.90/month idle** and **$16.15/month** for 500 profiles, 30 volunteer add/update journeys, and 60 staff searches per month, assuming normal account-wide CloudWatch allocations are available. See [`cost_model.md`](../cost_model.md) for formulas and [`DESIGN_REVIEW_COST_SCALABILITY.md`](../DESIGN_REVIEW_COST_SCALABILITY.md) for the scale-to-zero review.

The current deployment is pay-as-you-go CloudFront/WAF. An eligible paid AWS account could evaluate the $0/month CloudFront flat-rate Free plan, which now covers an associated WAF ACL and up to five rules. This system uses exactly five rules, so successful enrollment could reduce the first-year idle estimate to about $4.90/month. The Free plan has no uptime SLA and requires the compatibility and rollback process in [`RUNBOOK_ROLLOUT.md`](../RUNBOOK_ROLLOUT.md); it is not enabled automatically.

The low-idle-cost design uses private static S3/CloudFront hosting, on-demand Lambda/API Gateway/Data API, Aurora Serverless v2 at 0–2 ACU with five-minute auto-pause, daily lifecycle scheduling, and queue-driven background work. Cost is not zero: Aurora storage/backups, KMS keys/requests, Secrets Manager, WAF, CloudWatch, Cognito activity, SES, Bedrock inference, and Terraform state remain billable.

Lambda reserved concurrency caps are 20 public, 10 staff, and 2 for background functions. WAF rate rules protect magic request/redemption, interview, and search paths; application limits add narrower controls. Queues absorb feedback/re-embedding bursts, with 14-day DLQs. A monthly AWS Budget sends a forecast alert at 80%.

Before raising Aurora max ACU or Lambda concurrency, measure p95 latency, throttling, Data API errors, queue age, Bedrock quotas, and spend. A first request after Aurora auto-pause may be slow. If sustained traffic makes wake-up latency unacceptable, increase minimum ACU explicitly and update the budget. Never add body-level logging to diagnose performance.
