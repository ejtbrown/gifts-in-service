# Model, prompt, and embedding changes

1. Pin the new model/prompt version and document the reason. Confirm region/account access, privacy/retention, Guardrail behavior, cost, latency, and end-of-support posture from official AWS material.
2. Run deterministic AI evaluations plus targeted live evaluation with fictional text only. Include oversharing, boundaries, accounting/audit, teaching/screening, HVAC scope, multilingual facts, and prompt injection.
3. A prompt change affects only future drafts; approved text remains authoritative and is never silently rewritten.
4. An embedding model/dimension/version change requires a schema migration when dimension changes and a controlled queue campaign. Search filters to the configured model/version, so mixed rows fail closed rather than mixing vector spaces.
5. Send small re-embedding batches. The worker embeds exact approved prose and updates only when the approved-text hash is unchanged, preventing an older job from overwriting a newer profile.
6. Monitor queue/DLQ, Bedrock throttles/cost, candidate coverage, and evidence failures. Pause/redrive safely. Keep the prior model/version until coverage and rollback criteria pass.
