# ADR 0010: Diagnosis-free role-safety cautions

- Status: Accepted
- Date: 2026-08-07

## Context

A private health disclosure is not evidence that a person is safe or unsafe for a volunteer role. However, the same response may contain separate, concrete evidence relevant to a safeguarding-sensitive activity—for example, a close relative refusing to entrust an infant to the member. Omitting the entire response protects health privacy but can also erase a grounded concern. Allowing the interviewer or member to remove that concern later makes the safety control vulnerable to persuasion.

Church volunteering also extends beyond infant care. Denominational safeguarding guidance identifies roles involving children, vulnerable adults, volunteer driving, mentoring, pastoral or home visits, and positions of trust; federal guidance for houses of worship adds physical security, emergency planning, facilities, and cybersecurity. Relevant role controls also exist for finances, food service, and first-aid support. See the [Church of England safer-recruitment role examples](https://www.churchofengland.org/safeguarding/safeguarding-e-manual/safer-recruitment-and-people-management-guidance/appendix-what-roles-are-within-scope-safer-recruitment-and-people), [Episcopal Safe Church training matrix](https://www.episcopalchurch.org/wp-content/uploads/2024/05/Safe-Church-Safe-Communities-Full-File-Recommendations.pdf), [CISA house-of-worship security guidance](https://www.cisa.gov/resources-tools/resources/mitigating-attacks-houses-worship-security-guide), and [FEMA emergency-planning guidance](https://www.fema.gov/sites/default/files/2020-07/developing-eops-for-houses-of-worship.pdf). These sources inform the risk taxonomy; local church policy and applicable law remain authoritative.

The exact member-approved profile remains the only staff-visible and searchable record. The system must not create a hidden adverse dossier, expose health or family details, or infer risk from a diagnosis or protected characteristic.

## Decision

The API deterministically detects a bounded set of explicit safety cues when the response names a supported church-volunteer activity. It also recognizes narrowly phrased, first-person accounts of serious role-relevant conduct—such as violence, abuse, theft, serving while impaired, a safety-related removal, or refusal of screening or safeguarding controls—and uses a general placement review only when no supported role is named. A diagnosis, identity, allegation, rumor, lack of experience, ordinary mistake with no concrete safety significance, preference, or vague uncertainty alone never creates a concern.

The supported taxonomy is infant care, child supervision, vulnerable-adult care, passenger transport, financial handling, pastoral care/counseling/mentoring, home visitation, food service, medical/first-aid support, facilities/equipment work, security/emergency response, confidential-information or privileged-system access, and general role safety. Category-specific incident patterns cover common concrete failures such as leaving a person unattended, unsafe passenger driving, misuse of funds, boundary or confidentiality violations, unauthorized home entry, disregarding food allergies, incorrect medication administration, bypassing equipment safeguards, excessive force, and unauthorized disclosure of records.

For a qualifying response:

1. The server adds a canonical role code to the person-scoped pending interview. It stores no evidence, diagnosis, quotation, relationship, explanation, or score in that field. The field is never sent to staff search, logging, or the model and has the pending row's fixed 30-day expiry and deletion behavior.
2. If the response also contains health information, the original response is omitted before model processing and storage. The canonical role code is the only retained safety derivative. Otherwise the original response remains part of the ordinary pending transcript, but the entire concern turn and later removal instructions are omitted from profile-drafting source.
3. The application tells the member that a neutral caution will remain. The concern code is append-only for that pending interview; later persuasion, preference for the role, or model output cannot clear it.
4. The application appends a versioned, diagnosis-free sentence requiring staff discussion of the potential role-safety concern and the role's objective safeguards before placement. A general concern requires review before any placement. API validation and the repository's locked approval transaction both refuse exact prose that omits a required sentence.
5. Approval deletes the pending row. The exact caution in the approved prose is authoritative and visible to the member and staff. A later edit reconstructs the canonical requirement from that exact sentence so an edit cannot silently remove it. Search assigns a cautioned match no higher than `MEDIUM`.

## Consequences

The design favors staff review over automated clearance or rejection. It does not assign the member, determine fitness, or reveal why a concern exists. Members can decline to approve or can delete their profile, but they cannot save or update a profile that removes the required discussion sentence while the concern remains pending or authoritative in the current profile. A role-specific caution caps search relevance for that activity at `MEDIUM`; a general caution caps every search match at `MEDIUM`.

Deterministic text patterns can miss novel wording or create a false positive. Fixtures cover supported patterns and explicit non-evidence cases; changes to supported roles or wording require privacy, safeguarding, and legal review. Staff still must apply the church's screening, supervision, accommodation, and placement policies. This design is privacy minimization, not a claim of HIPAA compliance or a substitute for legal advice.
