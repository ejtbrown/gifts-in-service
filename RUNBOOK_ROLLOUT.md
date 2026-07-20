# Cost optimization rollout runbook

This runbook covers cost validation and potential CloudFront billing-plan changes. It does not authorize an infrastructure apply, production enrollment, or resource destruction. Use protected-environment approval and the existing deployment/rollback runbooks for any live change.

## 1. Establish the actual baseline

Wait for one complete calendar month after production deployment, then collect read-only evidence:

1. In Cost Explorer or the Cost and Usage Report, filter to `project=gifts-in-service` and `Environment=prod` where cost-allocation tags are active.
2. Reconcile WAF ACL/rule charges, KMS key storage, Secrets Manager secret-months, CloudWatch alarm metrics, Aurora ACU-hours/storage/I/O, Bedrock model/guardrail usage, Cognito MAUs, and SES messages.
3. Record the CloudWatch `ServerlessV2Usage` average/sum and the count of resume events. Confirm the database actually reaches 0 ACU.
4. Compare Nova input/output token EMF metrics with the assumptions in `cost_model.md`. Check that searches remain bounded to 10 candidates.
5. Confirm the Cognito user pool reports the Plus feature plan, then count distinct staff MAUs. Do not export staff email addresses or subject identifiers into the cost report.
6. Confirm that no dev stack was billed for the full month unless it was intentionally required.

Investigate when the production total is above $25 in the first year or above the applicable KMS-rotation-adjusted range. Common causes are an unpaused Aurora instance, a second environment, exhausted account-wide CloudWatch allocations, extra WAF rules, long reranker payloads, or inference retries.

## 2. Decide whether the CloudFront Free plan is acceptable

The Free plan is a candidate only if all of these are true:

- The payer is eligible. AWS states that Free Tier accounts cannot use CloudFront flat-rate plans; verify the account is on the appropriate paid account plan.
- Recent traffic is comfortably below 1 million allowed requests and 100 GB transfer per month.
- The application uses no more than five total WAF rules. The current Terraform has exactly five, leaving no rule-count headroom.
- Church and technical owners explicitly accept that the CloudFront Free and Pro plans do not include an uptime SLA.
- Private S3 origin access, the API custom origin, origin-verification header, custom response headers, cookies, CSRF header forwarding, and current WAF behavior are supported unchanged.
- Operators accept console/API billing-plan management if the pinned Terraform AWS provider cannot own the plan resource.

If an uptime SLA is required, retain pay-as-you-go pricing or evaluate an SLA-bearing plan on its merits. Do not choose the $15 Pro plan merely for cost savings; it is more expensive than the current $10 WAF floor at this workload and also lacks an uptime SLA.

## 3. Run a dev proof

1. Deploy a clean dev stack with fictional data only.
2. Save a Terraform plan and exported description of the distribution/WAF association before changing the billing plan.
3. In the CloudFront console, enroll only the dev distribution in the flat-rate Free plan. Do not alter production.
4. Verify the plan shows the existing associated WAF ACL and all five intended protections.
5. Run the following smoke tests:
   - static assets are accessible only through CloudFront;
   - magic-link request and fragment redemption work;
   - the member interview, draft, exact approval, update, reconfirmation, and deletion work;
   - staff Cognito/TOTP sign-in and grounded search work;
   - WAF common protections and all four rate-limited route families block/count as configured;
   - direct API Gateway requests without `X-GIS-Origin-Verify` are rejected;
   - direct S3 object access remains denied.
6. Run a fresh Terraform plan. Any unexpected attempt to replace the distribution or WAF association is a stop condition.
7. Observe dev for at least seven days, including one lifecycle run, and confirm billing-plan coverage in Cost Explorer.

## 4. Production rollout

Proceed only after the dev proof, privacy/security review, and an explicit no-SLA acceptance:

1. Announce the change window and name the rollback owner.
2. Capture current distribution, WAF, DNS, and billing-plan configuration without secrets.
3. Confirm CloudFront request/transfer usage and rule count are still eligible.
4. Enroll the production distribution through the reviewed AWS mechanism.
5. Repeat the security and functional smoke tests from the dev proof.
6. Monitor CloudFront, WAF blocks, API 5xx, Lambda errors, and member/staff sign-in for the change window.
7. Confirm the plan covers the associated WAF charges in the next available billing data.

## 5. Rollback

Rollback immediately if WAF rules change, Terraform detects destructive drift, origin verification fails, private S3 access changes, member/staff flows fail, or owners withdraw the no-SLA acceptance:

1. Switch the distribution back to pay-as-you-go pricing using the same approved AWS interface.
2. Confirm the original Terraform-managed WAF ACL is associated with the distribution.
3. Run a non-destructive Terraform plan. Do not apply a replacement distribution merely to repair billing-mode drift.
4. Repeat direct-origin rejection and the public/staff smoke tests.
5. Record the reason, duration, any service impact, and final WAF/distribution identifiers in the incident/change record without personal data.

Expected rollback cost is a return to approximately the $14.90/month first-year idle baseline, not a data migration.

## 6. Budget tuning

After a full-month baseline:

1. Separate this application's costs from unrelated account workloads.
2. Include KMS rotation growth: two keys add about $2/month after each of their first two rotations.
3. Consider lowering the production budget from $300 to about $50 with forecast and actual thresholds. Keep it notification-only unless a separate review approves automated actions.
4. Confirm alert delivery and retain the existing incident response path.

## 7. Re-estimation triggers

Re-run the model when any of these changes:

- a second environment becomes persistent;
- WAF rule count changes;
- CloudFront billing plan or account eligibility changes;
- Aurora minimum/max capacity, pause interval, engine version, or reader count changes;
- model IDs, Bedrock service tier, candidate cap, profile length, or interview turn count changes;
- distinct staff MAUs exceed 50 or federation pricing applies;
- traffic exceeds 1 million CloudFront requests, 100 GB transfer, or 1,000 volunteer/search workflows per month;
- log retention, alarm count, custom metric dimensions, KMS keys, or secret count changes.
