# Draft Privacy Notice

> Draft for church and Texas legal review. This repository does not assert legal compliance.

## In-product initial disclosure

### How Gifts in Service uses your information

Your approved Gifts in Service profile may be viewed by authorized church staff and designated ministry leaders for the purpose of identifying and contacting potential volunteers. Please do not include information you would not be comfortable sharing with those authorized users.

An AI assistant will help you describe skills, experience, hobbies, and interests you may be willing to share. Unfinished questions and answers are saved securely for up to 30 days so you can return, and are deleted when you approve the profile or that period ends. Only the profile text you review and approve is available to authorized staff or used in volunteer search. Account, consent, security, and lifecycle records needed to operate the service are also retained. AWS services process the conversation and approved profile to provide the assistant and search functions.

Submitting a profile does not commit you to accept any request to serve. Skills and qualifications are self-reported unless the church separately verifies them.

Gifts in Service is for adults age 18 or older.

## Full draft notice

Gifts in Service helps authorized church staff and designated ministry leaders identify adults who may be willing to share self-reported experience, practical abilities, hobbies, or interests. It is not a public directory, volunteer assignment system, credential verification service, background-check system, or pastoral-care record.

Before a profile is created or updated, an AI assistant helps the person describe what they may be willing to share and their boundaries. The application saves the pending questions and answers in its encrypted database for a fixed period of up to 30 days and sends them to AWS services to generate each response. They are available only through the person's authenticated profile session, are not available to staff search, and are deleted from the live database on profile approval, profile deletion, or expiry. Expired or deleted copies may remain in encrypted backups until the configured backup rotation ends and are unavailable to normal application users. Production use is blocked unless operators confirm that workload logging and AWS Bedrock retention settings do not capture prompts or completions.

The person reviews the exact profile before approval. The service then keeps the approved text; an embedding made only from that text; display name and verified emails; consent, status, and lifecycle dates; and narrowly necessary authentication, email-delivery, security, and audit records. Skills and qualifications are self-reported unless the church verifies them separately.

Authorized users may use profiles only to identify and contact possible volunteers. A profile does not commit anyone to accept a request. Staff should independently confirm current availability, licenses, screening, safety requirements, and professional scope.

Members can view and update the exact profile, change their display name, manage verified email addresses, pause/reactivate/reconfirm the profile, or permanently delete it. Deletion removes live profile/contact/session/token data in an idempotent purge and retains only a pseudonymous purge record without the name, email, text, or embedding. Deleted data may remain in encrypted backups for up to the configured rotation period—35 days in production. A restored backup is not opened for use until later purge events are replayed.

The service asks for annual reconfirmation beginning at 52 weeks, follows up at weeks 54 and 56, hides a profile from search at week 58, and permanently purges it at week 62 unless it is reconfirmed. Narrow security, delivery, lifecycle, and audit metadata may be retained for operational accountability; raw staff search text is redacted after the configured short period, while a deletion leaves only the pseudonymous purge proof described above.

Gifts in Service is for adults age 18 or older. It asks only for adult confirmation, not a birth date or exact age. People should not enter passwords, identification or account numbers, addresses, diagnoses, pastoral or family matters, background-check details, or information about others.

AWS provides hosting, database, email, authentication, and AI processing. GitHub may process deployment metadata for maintainers. The application intentionally includes no third-party analytics, advertising, tracking pixels, remote fonts, or public profile feed.

Questions, corrections, deletion help, or concerns should go to the configured privacy contact displayed in the deployed application. The church must replace example branding and contacts and approve this notice before production.
