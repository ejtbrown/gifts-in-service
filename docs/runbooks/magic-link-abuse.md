# Magic-link abuse

Review WAF counts/blocks, neutral-response rate, hashed application limits, SES sends, redemption failures/reuse, Lambda concurrency, and budget without exposing raw addresses/IPs/tokens. Tighten configurable WAF thresholds or temporarily block the request/redemption route; do not change the response to reveal account existence.

If a token key or origin secret may be exposed, rotate it and accept that outstanding links/sessions are invalidated. Keep fragments and email links out of tickets. Restore gradually, monitor distributed sources and deliverability, and preserve only sanitized counts, time windows and correlation IDs.
