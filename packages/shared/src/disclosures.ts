export const CONSENT_VERSION = "2026-08-04.v3";
export const PRIVACY_NOTICE_VERSION = "2026-08-04.draft-v3";

export const initialDisclosure = {
  version: CONSENT_VERSION,
  title: "How Gifts in Service uses your information",
  paragraphs: [
    "Your approved Gifts in Service profile may be viewed by authorized church staff and designated ministry leaders for the purpose of identifying and contacting potential volunteers. Please do not include information you would not be comfortable sharing with those authorized users.",
    "An artificial intelligence (AI) assistant—a computer program that writes replies based on patterns—will help you describe skills, experience, hobbies, and interests you may be willing to share. Your unfinished questions and answers are saved in protected form for up to 30 days so you can return. They are deleted when you approve your profile or when the 30 days end. Only the exact profile you review and approve is available to authorized staff or used in volunteer search.",
    "Submitting a profile does not commit you to accept any request to serve. Skills and qualifications are self-reported unless the church separately verifies them.",
    "Gifts in Service is for adults age 18 or older.",
  ],
} as const;

export const approvalDisclosure = {
  title: "Please review your profile carefully",
  paragraphs: [
    "Your approved Gifts in Service profile may be viewed by authorized church staff and designated ministry leaders for the purpose of identifying and contacting potential volunteers. Remove anything you would not be comfortable sharing with those authorized users.",
    "After you approve and save this profile, the unfinished conversation and draft notes used to prepare it are removed from the working service.",
    "Submitting this profile does not commit you to accept any request to serve. Skills, experience, licenses, and qualifications are self-reported unless the church separately verifies them.",
    "By selecting Approve and Save or Submit profile, or by clearly asking the assistant to submit the profile shown to you, you confirm that it is accurate enough for this purpose and agree that it may be stored and used as described in the Privacy Notice.",
  ],
} as const;
