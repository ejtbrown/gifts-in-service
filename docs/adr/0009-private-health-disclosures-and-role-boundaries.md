# ADR 0009: Private health disclosures and role boundaries

- Status: Accepted
- Date: 2026-08-06

## Context

Members can enter health information even though the interview asks them not to. A model may correctly recognize that information as private yet still repeat it in a proposed profile, especially when the disclosure uses a condition name without a phrase such as “diagnosed with.” A diagnosis or protected characteristic is not a reliable basis for software to decide whether a person is safe, qualified, or suitable for a volunteer role. At the same time, a member may use a private disclosure to express a real role-specific boundary that staff need to honor.

The distinction applies regardless of whether a particular disclosure is legally classified as protected health information in the operator's circumstances. The product must minimize health data and must not expose or operationalize diagnoses through profiles or search.

## Decision

Apply three independent controls:

1. The API deterministically recognizes common health-disclosure forms before calling the interview model. It does not retain or send the member's original response. It stores only a generic omitted-turn marker and a generic assistant question in the encrypted, person-scoped pending interview.
2. The assistant asks the member to restate only the affected activity and choose a functional boundary: rule the activity out, or request a discussion of the activity's objective requirements before placement. The system never asks the model to infer fitness from a diagnosis and never asks whether a diagnosis itself is disqualifying.
3. Profile-drafting source text is sanitized before model use. Proposed prose is rejected if it contains recognizable health information or refers to private, sensitive, privileged, or HIPAA information. The Bedrock adapter retries a rejected or malformed draft internally up to three total attempts and exposes an error only if every attempt fails.

Final wording is neutral. A ruled-out activity says that the member does not want to be considered for it; it does not call the member unqualified. A discuss-first activity tells staff to discuss objective role requirements and fit with the member before considering placement; it does not disclose that private information exists or why the discussion is needed.

Search deterministically classifies a ruled-out activity as `LOW` and omits it from returned staff results even if lexical or vector retrieval found the same activity name. A discuss-first boundary is no higher than `MEDIUM`. Neither path creates a hidden diagnosis, protected-class score, or suitability classification.

ADR 0010 adds a separate control for an explicit, grounded role-safety concern that appears alongside private health information. That control is triggered by the functional safety evidence and named activity, never by the health fact, and retains only a canonical role code until the member approves diagnosis-free caution prose.

## Consequences

Recognizable health input is not recoverable from the active transcript after interception. The member must restate any non-sensitive volunteering facts that appeared in the same response. The generic pending marker and follow-up have the same authorization, encryption, no-logging, fixed-expiry, and deletion behavior as other pending interview state.

Pattern matching is defense in depth, not a complete medical ontology. Prompts, output validation, member review, evaluations, and staff safety processes remain necessary. Existing approved profiles that contain prohibited information must be purged or corrected through a newly member-approved profile; the application must not silently rewrite authoritative approved prose.
