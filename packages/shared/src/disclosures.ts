export const CONSENT_VERSION = "2026-08-07.v4";
export const PRIVACY_NOTICE_VERSION = "2026-08-07.draft-v4";

export const initialDisclosure = {
  version: CONSENT_VERSION,
  title: "How Gifts in Service uses your information",
  paragraphs: [
    "Your approved Gifts in Service profile may be viewed by authorized church staff and designated ministry leaders for the purpose of identifying and contacting potential volunteers. Please do not include information you would not be comfortable sharing with those authorized users.",
    "An artificial intelligence (AI) assistant—a computer program that writes replies based on patterns—will help you describe skills, experience, hobbies, and interests you may be willing to share. Your unfinished questions and answers are saved in protected form for up to 30 days so you can return. They are deleted when you approve your profile or when the 30 days end. Only the exact profile you review and approve is available to authorized staff or used in volunteer search.",
    "If an answer raises a concrete concern about a volunteer activity or placement, the service may require neutral profile wording telling staff to discuss the concern and the role's objective safety requirements before placement. The wording will not state a diagnosis or private reason, and you will see it before deciding whether to approve the profile.",
    "Anyone who can use a verified email address associated with a profile—including anyone with access to a shared mailbox—may be able to open that profile and its unfinished conversation.",
    "Submitting a profile does not commit you to accept any request to serve. Skills and qualifications are self-reported unless the church separately verifies them.",
    "Gifts in Service is for adults age 18 or older.",
  ],
} as const;

export const approvalDisclosure = {
  title: "Please review your profile carefully",
  paragraphs: [
    "Your approved Gifts in Service profile may be viewed by authorized church staff and designated ministry leaders for the purpose of identifying and contacting potential volunteers. Remove anything you would not be comfortable sharing with those authorized users.",
    "Anyone who can use a verified email address associated with this profile—including anyone with access to a shared mailbox—may be able to open it.",
    "After you approve and save this profile, the unfinished conversation and conversation notes used to prepare it are removed from the working service.",
    "If the profile includes a required, neutral role-safety caution, staff must review that caution and the role's objective requirements before placement. The caution does not disclose a diagnosis or private reason and does not itself approve or reject you for a role.",
    "Submitting this profile does not commit you to accept any request to serve. Skills, experience, licenses, and qualifications are self-reported unless the church separately verifies them.",
    "By selecting Approve and Save or Submit profile, or by clearly asking the assistant to submit the profile shown to you, you confirm that it is accurate enough for this purpose and agree that it may be stored and used as described in the Privacy Notice.",
  ],
} as const;
