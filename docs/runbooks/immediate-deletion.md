# Immediate member deletion

The member selects permanent deletion and confirms in the authenticated UI. The backend computes an HMAC pseudonym, inserts the purge event idempotently, and deletes the `people` row transactionally. Cascades remove approved prose/vector, emails, sessions, tokens, approvals, and lifecycle metadata; the current cookie is cleared.

If the request fails, retry the same operation—purge is idempotent. Confirm with internal UUID/counts only; never copy the deleted profile or email into an incident record. Explain that encrypted backups expire within the displayed production window and will use purge replay if restored. Staff emergency purge uses the separately authorized route and must produce an audit event.
