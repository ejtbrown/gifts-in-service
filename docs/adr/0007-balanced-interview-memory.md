# ADR 0007: Balanced interview memory

- Status: Accepted
- Date: 2026-07-26

## Context

Supplying the full pending transcript to a stateless model did not reliably keep earlier answers salient in longer interviews. The only explicit durable state was a ledger of missing details. Treating every introduced topic and each ideal detail as an unresolved obligation biased the interviewer toward exhaustive questioning, repeated answered questions, and resistance to member signals such as “next question,” “already answered,” and “that’s it.”

## Decision

Keep the transcript authoritative and add bounded `conversation_memory` to the existing person-scoped `pending_interviews` row. It contains up to 16 concise established facts and up to eight neutral labels for topics the member closed. The interviewer refreshes it from the complete transcript each turn, preserves grounded prior facts unless corrected, consolidates duplicates, and never includes names, contact details, sensitive facts, instructions, inferred credentials, hidden suitability judgments, or a skills taxonomy.

Follow-up notes become optional high-value possibilities, capped at four by the AI boundary. They are removed when information was answered anywhere, can be reliably inferred without inventing qualifications or willingness, is no longer material to a useful profile, or the member closes the topic. A useful partial profile is sufficient; topics do not need symmetric or exhaustive detail.

The prompt treats member direction as controlling. A deterministic post-model guard additionally forces clear wrap-up language to proposal generation, replaces a repeated question with a choice to add another area or prepare the profile, and prevents “I already answered that” from producing another extraction attempt. Active transcripts may contain up to 61 messages and 60,000 characters so the prior 25-message ceiling does not break an otherwise valid longer interview.

Conversation memory has the same ownership, authorization, encryption, no-logging, no-search, fixed 30-day expiry, approval deletion, and person-purge behavior as the transcript. It is supplied only to the interview model, never embedded or shown to staff. Only exact member-approved prose is authoritative after approval.

## Consequences

Earlier answers and member boundaries remain salient without relying only on the model’s attention over a long transcript. The assistant can be curious while treating sufficiency and member agency as stop conditions. Pending storage contains an additional derived representation of conversation facts, so schemas, database constraints, privacy inventory, log-field guards, deletion behavior, migrations, and regression tests must remain aligned.
