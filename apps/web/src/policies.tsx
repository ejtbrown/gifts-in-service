import { useConfig } from "./context.js";

interface PolicyContentProps {
  sectionHeadingLevel?: "h2" | "h3";
}

export function PrivacyNoticeContent({
  sectionHeadingLevel = "h2",
}: PolicyContentProps) {
  const config = useConfig();
  const Heading = sectionHeadingLevel;
  return (
    <>
      <p>
        Gifts in Service collects a display name, verified email associations,
        pending interview questions and answers, exact volunteer profile prose
        that a person reviews and approves, an embedding made only from that
        prose, consent and lifecycle timestamps, authentication records,
        deliverability state, and narrow security/audit events. It is for adults
        age 18 or older; it does not collect a date of birth.
      </p>
      <Heading>Purpose and viewers</Heading>
      <p>
        Authorized church staff and designated ministry leaders use active
        profiles only to identify and contact possible volunteers. The
        information is not a public or member directory and is not used for
        marketing, fundraising, autonomous outreach, spiritual-value ranking, or
        automatic assignment.
      </p>
      <Heading>AI and AWS processing</Heading>
      <p>
        AWS services process the active interview, approved profile, and staff
        search request. Unfinished interview questions and answers are stored in
        the encrypted application database for up to 30 days so a member can
        resume. They are available only through that member's authenticated
        profile session, are never included in analytics, logs, traces, staff
        search, or error reporting, and are deleted when the profile is approved
        or the 30-day period ends. Production is blocked unless the church
        confirms zero-retention and disabled model-invocation body logging for
        this workload.
      </p>
      <Heading>Self-reported information</Heading>
      <p>
        Skills, experience, licenses, certifications, and qualifications are
        self-reported unless the church verifies them separately. Submitting a
        profile does not commit anyone to accept a request. Screening and
        professional verification are separate church processes.
      </p>
      <Heading>Control and retention</Heading>
      <p>
        A person can view, update, reconfirm, pause, reactivate, or permanently
        delete their profile and manage verified emails. A pending interview is
        deleted on profile approval or 30 days after it begins, whichever comes
        first. Reminders begin after 52 weeks; a profile is hidden at 58 weeks
        and purged at 62 weeks without reconfirmation. Deletion removes live
        profile/contact/session/token/interview data in one purge operation.
        Minimal pseudonymous security events remain. Deleted or expired data may
        remain in encrypted backups until rotation, normally no more than 35
        days in production, and is unavailable to normal application users.
      </p>
      <Heading>Contact</Heading>
      <p>
        Questions and privacy requests:{" "}
        <a href={`mailto:${config.privacyContactEmail}`}>
          {config.privacyContactEmail}
        </a>
        .
      </p>
      <p>
        <strong>
          This draft does not assert compliance with any named law.
        </strong>{" "}
        Church leadership and Texas counsel must review it before production
        use.
      </p>
    </>
  );
}

export function PrivacyPage() {
  return (
    <article className="policy narrow">
      <p className="eyebrow">Draft · legal review required</p>
      <h1>Privacy Notice</h1>
      <PrivacyNoticeContent />
    </article>
  );
}

export function AiUseContent({
  sectionHeadingLevel = "h2",
}: PolicyContentProps) {
  const Heading = sectionHeadingLevel;
  return (
    <>
      <p>
        AI asks adaptive questions and prepares a draft from what you say. You
        see the entire proposed profile and nothing is saved until you select{" "}
        <strong>Approve and Save</strong> or <strong>Submit profile</strong>, or
        clearly ask the assistant to submit that proposal. The exact approved
        text—not a hidden list of inferred skills—is the authoritative record.
      </p>
      <Heading>What is kept temporarily</Heading>
      <p>
        Unfinished interview questions and answers are saved in the encrypted
        application database for up to 30 days so you can return after closing
        the page or requesting a new magic link. They are deleted when you
        approve and save the profile or when the 30-day period ends. They are
        not searchable by staff. The system does not use Bedrock Agents,
        Knowledge Bases, or stateful model sessions.
      </p>
      <Heading>Search</Heading>
      <p>
        Staff searches use full-text and semantic retrieval, then AI may explain
        why bounded candidate prose relates to a request. Names and contact
        details are not sent to embedding or reranking models. Evidence must be
        copied exactly from approved prose; invalid output falls back to
        deterministic ordering.
      </p>
      <Heading>Limits</Heading>
      <p>
        AI can be wrong. It cannot verify credentials, licensing, safety,
        willingness, background screening, or availability, and it does not
        assign volunteers. Deterministic validation and an AWS guardrail reduce
        sensitive-data risk but cannot make it zero.
      </p>
    </>
  );
}

export function AiUsePage() {
  return (
    <article className="policy narrow">
      <p className="eyebrow">Plain-language explanation</p>
      <h1>How AI is used</h1>
      <AiUseContent />
    </article>
  );
}
