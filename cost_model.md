# Gifts in Service AWS cost model

Pricing checked: 2026-07-16. Currency: USD. Region: US East (N. Virginia), `us-east-1`.

This is a repository-derived estimate, not an AWS bill or Pricing Calculator export. It models one production stack plus the shared Terraform bootstrap resources. It excludes a simultaneously deployed dev stack, taxes, support plans, a purchased domain, and organization-wide usage that consumes account-level free allocations.

## Workload assumptions

- 500 approved volunteer profiles in Aurora PostgreSQL.
- 30 volunteer add/update journeys per month.
- Each journey has five interview turns, one draft call, one Titan embedding, one magic-link email, and about 15 minutes between its first and final database activity.
- 60 staff searches per month, distributed as isolated search events.
- Each search has one Nova planning call, one Titan embedding, one Nova reranking call over up to 10 candidates, and one five-minute Aurora wake window.
- Three distinct staff accounts are monthly active users. Cognito cost changes by about $0.02 for each distinct staff MAU, not for each search.
- Normal approved prose averages about 200 words. Search reranking therefore supplies roughly 10,000 characters of candidate evidence per search.
- Lambda functions use the configured arm64 architecture and no provisioned concurrency.
- Aurora runs at 0–2 ACU and pauses after five idle minutes. Active low-volume windows are modeled at 0.5 ACU; a sensitivity range up to 1 ACU is also reported.
- The daily lifecycle schedule wakes Aurora once each day even with no member or staff activity.
- The likely-bill view assumes this account has the standard CloudWatch free allocations available. The list-price view does not apply those allocations.

## Current prices used

| Service                                 |                                                                                                                 Price used |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------: |
| AWS WAF                                 |                                                                  $5/web ACL-month + $1/rule-month + $0.60/million requests |
| KMS                                     |                                                            $1/customer-managed key-month; first 20,000 requests/month free |
| Secrets Manager                         |                                                                                $0.40/secret-month + $0.05/10,000 API calls |
| CloudWatch                              | $0.10/standard alarm metric-month, $3/custom dashboard-month, $0.30/custom metric-month; free allocations are account-wide |
| Aurora Serverless v2 PostgreSQL         |                                                                         $0.12/ACU-hour, $0.10/GB-month, $0.20/million I/Os |
| Nova 2 Lite Standard tier               |                                                                   $0.30/million input tokens + $2.50/million output tokens |
| Titan Text Embeddings v2                |                                                                                                 $0.02/million input tokens |
| Bedrock sensitive-information guardrail |                                                                 $0.10/1,000 text units; one unit is up to 1,000 characters |
| Cognito Plus tier                       |                                                $0.02/distinct MAU at this volume; Plus has no direct-sign-in MAU free tier |
| API Gateway HTTP API                    |                                                                                      $1/million requests at the first tier |
| Lambda                                  |        $0.20/million requests plus arm64 GB-second duration; the configured volume is far below the Lambda free allocation |
| SES                                     |                                                                              $0.10/1,000 outbound emails plus message data |

Primary sources: [WAF pricing](https://aws.amazon.com/waf/pricing/), [KMS pricing](https://aws.amazon.com/kms/pricing/), [Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/), [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/), [Aurora pricing](https://aws.amazon.com/rds/aurora/pricing/), [Aurora `us-east-1` public price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/us-east-1/index.json), [Aurora auto-pause billing](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html), [Bedrock pricing](https://aws.amazon.com/bedrock/pricing/), [Bedrock public metered-unit map](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/bedrock/USD/current/bedrock.json), [Cognito pricing](https://aws.amazon.com/cognito/pricing/), [Cognito feature-plan behavior](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-sign-in-feature-plans.html), [API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/), [Lambda pricing](https://aws.amazon.com/lambda/pricing/), and [SES pricing](https://aws.amazon.com/ses/pricing/).

The public Bedrock map was published 2026-07-07. Its unit rates are multiplied by 1,000 by the AWS pricing page to display per-million-token prices. The Terraform does not explicitly set `user_pool_tier`, but it sets `advanced_security_mode = "ENFORCED"`; current Cognito documentation says threat protection requires Plus and defaults the pool to Plus when the tier is omitted in that combination. Confirm the effective tier after deployment because older pre-tier pools can remain on legacy ASF pricing.

## Idle monthly floor

| Resource                                           | Formula                                               | Likely bill with available account free allocations | List price without free allocations |
| -------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------: | ----------------------------------: |
| WAF                                                | 1 ACL × $5 + 5 rules × $1                             |                                              $10.00 |                              $10.00 |
| KMS key storage, first year                        | state key + production application key                |                                               $2.00 |                               $2.00 |
| Secrets Manager                                    | 4 secrets × $0.40                                     |                                               $1.60 |                               $1.60 |
| CloudWatch alarms                                  | 21 standard alarms; first 10 free in likely-bill case |                                               $1.10 |                               $2.10 |
| CloudWatch dashboard                               | 1 dashboard; first 3 are free in likely-bill case     |                                               $0.00 |                               $3.00 |
| Daily Aurora lifecycle wake                        | 30 × 5.25 minutes × 0.5 ACU × $0.12/60                |                                               $0.16 |                               $0.16 |
| Aurora storage                                     | conservative 0.25 GB × $0.10                          |                                               $0.03 |                               $0.03 |
| S3 state/web storage and requests                  | tiny static site and state files                      |                                               $0.01 |                               $0.01 |
| Logs, metrics, I/O, scheduler, queues, API, Lambda | negligible idle events                                |                                               $0.00 |                               $0.02 |
| **Estimated idle total**                           |                                                       |                                    **$14.90/month** |                    **$18.92/month** |

Reasonable idle planning range: **$14.75–$15.25/month** when the account-level CloudWatch allocations are available, or approximately **$19/month** at un-discounted list price.

The 500 volunteer rows do not materially change the storage line. A 1,024-dimension pgvector value is approximately 4 KiB before row/index overhead, so 500 profiles plus prose and indexes are only a few megabytes. The 0.25 GB allowance above includes PostgreSQL catalogs and substantial headroom. Aurora backup usage should remain inside the included allowance at this write rate; AWS does not charge for backup storage up to 100% of the active cluster's storage.

### KMS rotation sensitivity

Both customer-managed keys have automatic rotation enabled. AWS charges another $1/key-month for each of the first two retained rotations. If both keys rotate together, add about **$2/month after their first rotation** and another **$2/month after their second rotation**. The mature-key idle estimate is therefore about $18.90/month with CloudWatch allocations, before workload usage.

## Stated-workload variable cost

### Bedrock

Nova workload:

```text
Volunteer input  = 30 × 7,000 tokens = 210,000
Volunteer output = 30 × 1,000 tokens = 30,000
Search input     = 60 × 3,200 tokens = 192,000
Search output    = 60 × 550 tokens = 33,000

Nova = 402,000 / 1,000,000 × $0.30
     + 63,000 / 1,000,000 × $2.50
     = $0.28/month
```

Guardrail workload:

```text
Guardrail = (30 × 20 text units + 60 × 12 text units)
          / 1,000 × $0.10
          = $0.13/month
```

Titan embeddings are under $0.001/month at this volume. Estimated AI total: **$0.41/month**, with a practical range of roughly **$0.25–$0.90** depending on interview length, generated output, candidate prose length, and retry rate.

### Aurora compute added by user activity

```text
Volunteer windows = 30 × 15 minutes = 450 minutes
Search windows    = 60 × 5 minutes  = 300 minutes

Aurora = 750 / 60 × 0.5 ACU × $0.12 = $0.75/month
```

This is deliberately conservative for isolated searches. Searches clustered within the same five-minute window cost less. If resumed capacity averages 1 ACU instead of 0.5, the same activity costs $1.50/month.

### Remaining variable services

| Service                                                                          |                                                                                               Monthly estimate |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------: |
| Cognito Plus, assuming 3 staff MAUs                                              |                                                                                                          $0.06 |
| SES, 30 magic-link emails before any email free tier                             |                                                                                                         $0.003 |
| API Gateway, Lambda, WAF requests, SQS, SNS, Scheduler, KMS requests, Aurora I/O |                                                    <$0.03 at list price; normally absorbed by free allocations |
| Logs and custom metrics                                                          | approximately $0 with free allocations; up to about $0.70 if all account free allocations are already consumed |

### Monthly total at the requested workload

| View                                                                |    Idle floor | Incremental workload |                 Total |
| ------------------------------------------------------------------- | ------------: | -------------------: | --------------------: |
| Likely bill, first-year keys and available account free allocations |        $14.90 |                $1.25 |      **$16.15/month** |
| Planning range                                                      | $14.75–$15.25 |          $1.25–$3.00 |     **$16–$18/month** |
| List price with no CloudWatch/Lambda/API free allocations           |        $18.92 |           about $1.9 | **about $20.8/month** |

This workload is light rather than sustained load: it averages one volunteer journey per day and two searches per day.

## Marginal cost formulas

- One typical volunteer add/update journey: approximately **$0.02–$0.04**, dominated by its Aurora active window and Nova/guardrail calls.
- One isolated staff search: approximately **$0.009–$0.018**, dominated by reranking and the five-minute Aurora window. Cognito is per distinct staff MAU, not per search.
- 1,000 ordinary non-AI API requests at 1 GiB and 250 ms average duration: about **$0.005** list price before database work, data transfer, logging, and free allocations.
- Every additional distinct staff MAU: approximately **$0.02/month** on the Cognito Plus tier implied by the currently enforced threat-protection mode.
- Every additional isolated Aurora wake window at 0.5 ACU and five minutes: approximately **$0.005**.

## Environment multiplier

Leaving both dev and prod deployed is materially different from one production stack. Two application stacks plus the shared bootstrap key are approximately **$30/month** with shared CloudWatch free allocations, or about **$37/month** at list price, before workload. Destroy dev when it is not actively needed.

## Break-even: CloudFront flat-rate Free plan

The current Terraform uses pay-as-you-go CloudFront and WAF. AWS now offers an eligible paid account a $0/month CloudFront flat-rate Free plan that covers the associated WAF ACL, managed/custom rules, request fees, and up to five WAF rules. This distribution uses exactly five rules, so the plan could remove the $10/month WAF floor and reduce the first-year idle estimate to approximately **$4.90/month**.

This is not an automatic recommendation: the Free and Pro plans do not include an uptime SLA, eligibility depends on the AWS account and recent usage, plan configuration is currently console-oriented, and plan-controlled WAF behavior must be compared with the Terraform-managed ACL. See the design review and rollout runbook before changing billing mode.
