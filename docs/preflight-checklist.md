# Production preflight checklist

Run this before every production apply and record the reviewer/date in the church's change record. Do not put evidence containing prompts, profiles, tokens, or addresses in this repository.

- [ ] Church name, contacts, disclosure, Privacy Notice, AI explanation, and backup wording were approved by the church and Texas counsel.
- [ ] Bedrock terms/account controls for this workload confirm zero prompt/output retention.
- [ ] `aws bedrock get-model-invocation-logging-configuration` shows no prompt/output destinations or data delivery.
- [ ] API Gateway access logs, Lambda application logs, WAF sampling, CloudFront logs, tracing, error reporting, and dashboards contain no request/response bodies.
- [ ] Nova inference profiles, Titan Embeddings v2, and the deployed Guardrail are available in the selected region/account.
- [ ] SES sender/domain is verified, DKIM is healthy, production access is enabled, suppression is enabled, and SNS/SQS feedback reaches the worker.
- [ ] Cognito bootstrap administrator uses TOTP; groups and protected GitHub Environment reviewers are correct.
- [ ] KMS keys are enabled, Aurora backup/auto-pause settings are accepted, alarms have recipients, and monthly budget is appropriate.
- [ ] Lambda ZIPs and web assets were produced from the reviewed commit; migration/rollback implications were reviewed.
- [ ] A fictional smoke test covers member approval, staff search/evidence, pause, and deletion.

The workflow runs `pnpm preflight -- --production`. It requires the five explicit confirmation variables documented in [initial deployment](runbooks/initial-deployment.md), checks AWS identity, rejects configured Bedrock invocation logging, and requires verified/enabled SES production sending. Terraform independently refuses production unless its privacy and SES preconditions are true.
