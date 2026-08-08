import { useConfig } from "./context.js";
import { PlainLanguageTerm } from "./components.js";

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
        Gifts in Service keeps only the information needed to create and manage
        a volunteer profile. This includes your display name, verified email
        addresses, unfinished conversation with the assistant, the exact profile
        you approve, and a computer-generated search aid made only from that
        approved profile. It also keeps dates showing your agreement and profile
        status, whether email was delivered, and limited records needed for
        sign-in, security, and accountability.
      </p>
      <p>
        Gifts in Service is for adults age 18 or older. It asks you to confirm
        that you are an adult, but it does not ask for your birth date or exact
        age.
      </p>
      <Heading>Purpose and viewers</Heading>
      <p>
        Church staff and ministry leaders with permission may use active
        profiles only to identify and contact possible volunteers. Profiles are
        not public and are not a directory for church members. They are not used
        for marketing, fundraising, ranking a person's value or faith, sending
        messages without a person involved, or automatically assigning anyone to
        serve.
      </p>
      <Heading>How the online service and computer assistant work</Heading>
      <p>
        <PlainLanguageTerm
          title="Amazon Web Services (AWS)"
          explanation="Amazon Web Services is the outside technology company that runs the secure computers, database, email, sign-in, computer assistant, and search tools used by Gifts in Service."
        >
          Amazon Web Services (AWS)
        </PlainLanguageTerm>{" "}
        runs the online service, computer assistant, and search tools. It
        processes the current conversation, an approved profile, or a staff
        search only when needed to provide that feature.
      </p>
      <p>
        Unfinished questions and answers, any proposal shown inside the
        resumable conversation, and short notes that help the assistant remember
        what you have already said are saved in an{" "}
        <PlainLanguageTerm
          title="Encryption"
          explanation="Encryption scrambles stored information. People or systems without the right digital key cannot read it."
        >
          encrypted
        </PlainLanguageTerm>{" "}
        database for no more than 30 days. This lets you return without starting
        over. A separate draft opened on the final-review page after you select{" "}
        <strong>Create a draft</strong> stays only in the current browser tab
        and is lost if you reload or close it.
      </p>
      <p>
        Anyone who can use a verified email address associated with your profile
        can reach the saved unfinished conversation. If you use a shared
        mailbox, anyone with access to that mailbox may be able to open it. It
        is not available in staff search or site-use tracking, and the
        application does not put it in its logs or error reports. It is deleted
        when you approve your profile or when the 30 days end.
      </p>
      <p>
        If the service recognizes a health disclosure, it replaces that response
        with a generic omitted-turn marker. If an answer separately raises a
        concrete concern about a volunteer activity or placement, the unfinished
        conversation keeps only a broad role category—not the diagnosis,
        evidence, relationship, or private reason. The profile may then require
        neutral wording telling staff to discuss the concern and the role&apos;s
        objective safeguards before placement. You see that wording before
        deciding whether to approve the profile.
      </p>
      <p>
        Before the church launches the service, it must confirm that the company
        providing the computer assistant will not keep these conversations or
        record their contents in its service logs.
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
        delete their profile and manage verified email addresses. An unfinished
        conversation is deleted when the profile is approved or 30 days after
        the conversation starts, whichever happens first.
      </p>
      <p>
        The service asks once a year whether the profile is still correct. If
        the person does not respond, the profile is hidden from search after 58
        weeks and permanently deleted after 62 weeks. A deletion removes the
        profile, contact information, unfinished conversation, and access to
        that profile from signed-in devices and sign-in links. A mailbox-wide
        sign-in link may still open another profile associated with the same
        address or start a new profile, but it cannot reopen the deleted
        profile. A small security record may remain, but it does not contain the
        person's name, email, or profile. Protected backup copies may contain
        deleted information for up to 35 more days. Those copies are not
        available through the normal service and are removed as old backups
        expire.
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
          This draft does not claim compliance with any particular law.
        </strong>{" "}
        Church leaders and a Texas lawyer must review it before the service is
        used with real member information.
      </p>
    </>
  );
}

export function PrivacyPage() {
  return (
    <article className="policy narrow">
      <p className="eyebrow">Draft · church and legal review required</p>
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
        <PlainLanguageTerm
          title="Artificial intelligence (AI)"
          explanation="Artificial intelligence, or AI, is software that uses patterns from examples to create text or make suggestions. It is a tool, not a person, and it does not understand or judge you the way a person does."
        >
          Artificial intelligence (AI)
        </PlainLanguageTerm>{" "}
        asks questions based on what you have already said and prepares a draft
        in your own words. You may answer one piece at a time. The assistant
        keeps a simple progress estimate to decide whether another question
        would help or whether it can offer to finish. That estimate is not a
        rating of you, is never shown to staff, and is never used in staff
        search.
      </p>
      <p>
        You see the entire proposed profile before it is saved. Nothing becomes
        your profile until you select <strong>Approve and Save</strong> or{" "}
        <strong>Submit profile</strong>, or clearly ask the assistant to submit
        the proposal shown to you. The exact words you approve are the official
        saved profile. The service does not keep a hidden list of skills it
        guessed about you.
      </p>
      <Heading>What is kept temporarily</Heading>
      <p>
        Unfinished interview questions and answers, any proposal shown inside
        the resumable conversation, the simple progress estimate, and short
        notes that help the assistant remember what you said or chose to skip
        are saved in an{" "}
        <PlainLanguageTerm
          title="Encryption"
          explanation="Encryption scrambles stored information. People or systems without the right digital key cannot read it."
        >
          encrypted
        </PlainLanguageTerm>{" "}
        database for no more than 30 days. This lets you return after closing
        the page or requesting a new sign-in email. A separate draft opened on
        the final-review page after selecting <strong>Create a draft</strong>{" "}
        stays only in the current browser tab and is lost if it is reloaded or
        closed.
      </p>
      <p>
        If the service recognizes a health disclosure, it does not keep that
        response. It keeps only a generic marker that the turn was omitted and
        asks you to restate a non-sensitive, functional boundary for the
        affected volunteer activity.
      </p>
      <p>
        If an answer separately raises a concrete safety concern about a
        volunteer activity or placement, the unfinished conversation keeps only
        a broad role category—not the diagnosis, evidence, relationship, or
        private reason. The service requires neutral profile wording telling
        staff to discuss the concern and objective safeguards before placement.
        You see that wording before approval, but it cannot be removed while the
        concern remains part of the unfinished interview.
      </p>
      <p>
        Anyone who can use a verified email address associated with the profile
        can reach the saved unfinished conversation. If the address is a shared
        mailbox, anyone with access to that mailbox may be able to open it.
        Staff cannot search it or use it to rate you. It is deleted when you
        approve and save the profile or when the 30 days end.
      </p>
      <Heading>How staff search works</Heading>
      <p>
        When staff search, the service looks for exact words, related meanings,
        and close spellings only in approved profiles. AI may then reorder those
        possible matches and explain why a profile may fit the request. Names
        and contact details are not sent to the AI search tool. Every result
        includes evidence copied exactly from the approved profile. The AI may
        write a separate explanation of the possible match. If the AI gives
        unusable evidence or an unusable answer, the service uses fixed non-AI
        rules instead.
      </p>
      <Heading>Limits</Heading>
      <p>
        AI can be wrong. It cannot verify credentials, licensing, safety,
        willingness, background screening, or availability, and it does not
        assign volunteers. Software checks and safety filters reduce the chance
        of accepting sensitive information or showing an unsupported answer, but
        no filter is perfect.
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
