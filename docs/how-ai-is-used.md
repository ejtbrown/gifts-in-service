# How AI is used

The AI assistant asks focused questions, helps produce a concise profile draft, turns a staff search into retrieval terms, and reranks only profiles already found by database search. It does not assign work, verify credentials, decide suitability, or silently add qualifications.

During an interview, questions and answers are stored in the encrypted application database for up to 30 days so the member can resume after a refresh or newly redeemed magic link. The transcript is scoped to the owning person, is never logged or exposed to staff search, and is deleted when the member approves the profile or the fixed 30-day period expires. The backend supplies it to stateless Amazon Bedrock requests. The exact draft must be reviewed and approved. Only that approved prose becomes searchable, and its embedding is generated from that prose alone—not the name, email, conversation, audit data, or staff notes.

Search combines full-text, semantic, and typo-tolerant database retrieval. The model can reorder only those candidates. Every displayed match reason must cite focused text present in the approved profile; otherwise deterministic validation rejects the model response and the service falls back safely. The fallback extracts the most relevant exact sentences, assigns every candidate a `HIGH`, `MEDIUM`, or `LOW` grade, and lowers the grade when the relevant evidence describes a limitation or developing skill. The complete approved profile remains available in a collapsed section but is not a substitute for the explanation and evidence.

Prompts coach people not to share unnecessary sensitive information. Deterministic checks reject recognizable credentials and high-risk identification or financial numbers before the response is added to the pending interview. A Bedrock Guardrail adds defense in depth for model requests. Either kind of rejection returns an explicit message explaining that the response was not accepted because it appears to contain sensitive personal information and asks the person to remove it and try again. The message never repeats the detected value. No filter is perfect. A privacy-sensitive revision always requires fresh review; the application never silently edits approved text.

AI and policy configuration require operator review. Production deployment fails unless Bedrock retention and invocation logging, infrastructure body logging, SES readiness, and policy review are confirmed. Model IDs, prompt versions, embeddings, and evaluation fixtures are versioned so changes can be tested and re-embedded deliberately.

The interviewer returns a bounded action decision as well as conversational
text. It may continue the interview, request that the dedicated profile
drafter prepare an exact proposal, or recognize a clear request to submit the
most recently displayed proposal. Questions, uncertainty, and change requests
are not submission intent. A profile is saved only from the exact
server-authoritative proposal displayed to the member (or an exact proposal
copied from the most recent legacy assistant message), never from a newly
generated variant at submission time.
