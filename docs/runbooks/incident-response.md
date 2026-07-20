# Incident response

1. Classify the incident: unauthorized access, token/session compromise, body logging/AI retention, deletion failure, email abuse, availability/cost, or data corruption.
2. Contain without collecting more personal data: block affected routes at WAF/CloudFront, cap/disable Lambdas, stop SES sends, revoke Cognito/member/staff sessions, and suspend deploy credentials as appropriate.
3. Preserve sanitized CloudTrail, CloudWatch metric/error, SES message ID, audit UUID, deploy SHA, and configuration evidence. Do not paste interview text, profiles, emails, tokens, secrets, or request bodies into tickets/chat.
4. If prompt/output logging or unexpected Bedrock retention is suspected, disable interview and search inference immediately. Production privacy claims are fail-closed until independently revalidated.
5. Rotate affected secrets/keys using [key rotation](key-rotation.md), correct the cause, replay or purge data idempotently, and use fictional smoke tests.
6. Follow church counsel and leadership direction for assessment and notification. This repository does not define legal reporting obligations.
7. Restore service only after authorization boundaries, deletion/lifecycle, logs, alarms, email feedback, and direct-origin protections pass review. Record root cause and prevention without personal data.
