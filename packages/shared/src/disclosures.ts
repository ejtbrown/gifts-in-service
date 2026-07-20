export const CONSENT_VERSION = "2026-07-16.v2";
export const PRIVACY_NOTICE_VERSION = "2026-07-16.draft-v2";

export const initialDisclosure = {
  version: CONSENT_VERSION,
  title: "How Gifts in Service uses your information",
  paragraphs: [
    "Your approved Gifts in Service profile may be viewed by authorized church staff and designated ministry leaders for the purpose of identifying and contacting potential volunteers. Please do not include information you would not be comfortable sharing with those authorized users.",
    "An AI assistant will help you describe skills, experience, hobbies, and interests you may be willing to share. Your unfinished questions and answers are saved securely for up to 30 days so you can return, and are deleted when you approve your profile or when that period ends. Only the profile text you review and approve is available to authorized staff or used in volunteer search. AWS services process the conversation and approved profile to provide the assistant and search functions.",
    "Submitting a profile does not commit you to accept any request to serve. Skills and qualifications are self-reported unless the church separately verifies them.",
    "Gifts in Service is for adults age 18 or older.",
  ],
} as const;

export const approvalDisclosure = {
  title: "Please review your profile carefully",
  paragraphs: [
    "Your approved Gifts in Service profile may be viewed by authorized church staff and designated ministry leaders for the purpose of identifying and contacting potential volunteers. Remove anything you would not be comfortable sharing with those authorized users.",
    "The pending interview questions and answers used to prepare this draft are deleted from the live application after you approve and save it.",
    "Submitting this profile does not commit you to accept any request to serve. Skills, experience, licenses, and qualifications are self-reported unless the church separately verifies them.",
    "By selecting Approve and Save or Submit profile, or by clearly asking the assistant to submit the exact proposed profile, you confirm that it is accurate enough for this purpose and consent to its storage and use as described in the Privacy Notice.",
  ],
} as const;
