import {
  CONSENT_VERSION,
  type InterviewCompleteness,
  type InterviewMessage,
} from "@gis/shared";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, getMemberSession, setMemberCsrf } from "./api.js";
import { Loading, Notice } from "./components.js";
import { useConfig } from "./context.js";
import { AiUseContent, PrivacyNoticeContent } from "./policies.js";
import type { MemberSessionResponse } from "./types.js";

const PROFILE_SAVED_NOTICE =
  "Your profile has been saved. No further action is necessary unless you want to make changes.";
const PROFILE_SAVED_NAVIGATION_STATE = { profileSaved: true } as const;

function profileWasJustSaved(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    "profileSaved" in state &&
    state.profileSaved === true
  );
}

export function LandingPage() {
  const config = useConfig();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await api<{ message: string }>(
        "/api/public/magic-links",
        {
          method: "POST",
          body: JSON.stringify({
            email: data.get("email"),
          }),
        },
      );
      void navigate("/check-email", { state: { message: response.message } });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Please check the form and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="landing-page">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-intro">
          <p className="eyebrow">
            A private way to describe how you might help
          </p>
          <h1 id="landing-title">Share your gifts, in your own words</h1>
          <div className="heading-accent" aria-hidden="true" />
          <p className="lede">
            A short AI-assisted conversation helps you create a profile that you
            review before anything is saved. You can always decline a future
            request.
          </p>
          <div className="service-note">
            <span aria-hidden="true">♡</span>
            <p>
              Your experience can meet a real need and make a lasting
              difference.
            </p>
          </div>
        </div>
        <div className="signup-card">
          <p className="eyebrow">Begin securely</p>
          <h2>Tell us how you would like to serve</h2>
          <p>
            Enter your email and we will send a private, short-lived link to
            start your conversation.
          </p>
          <form
            onSubmit={(event) => void submit(event)}
            aria-describedby={error ? "request-error" : "email-help"}
          >
            <div className="field">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
              />
              <span id="email-help" className="field-help">
                Your secure link expires and can only be used once.
              </span>
            </div>
            {error && (
              <p id="request-error" className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary large" disabled={busy}>
              {busy ? "Sending…" : "Email me a secure link"}
            </button>
          </form>
        </div>
      </section>
      <section
        className="disclosure landing-disclosures"
        aria-label="Privacy and AI information"
      >
        <details>
          <summary>{config.disclosure.title}</summary>
          <div className="accordion-content">
            {config.disclosure.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </details>
        <details>
          <summary>How AI is used</summary>
          <div className="accordion-content">
            <AiUseContent sectionHeadingLevel="h3" />
            <p>
              <Link to="/ai-use">
                Open the AI explanation as a separate page
              </Link>
            </p>
          </div>
        </details>
        <details>
          <summary>Full privacy statement</summary>
          <div className="accordion-content">
            <PrivacyNoticeContent sectionHeadingLevel="h3" />
            <p>
              <Link to="/privacy">
                Open the full privacy statement as a separate page
              </Link>
            </p>
          </div>
        </details>
      </section>
    </div>
  );
}

export function CheckEmailPage() {
  const location = useLocation();
  const message =
    (location.state as { message?: string } | null)?.message ??
    "If the address can receive a Gifts in Service link, an email has been sent.";
  return (
    <div className="narrow">
      <h1>Check your email</h1>
      <Notice tone="success">
        <p>{message}</p>
      </Notice>
      <p>
        The link is short-lived and works once. Check spam if it does not
        arrive. You may safely request another link.
      </p>
      <Link className="button secondary" to="/">
        Return home
      </Link>
    </div>
  );
}

const fragmentTokens = new Map<string, string>();

function fragmentToken(): string {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  if (token) fragmentTokens.set(window.location.pathname, token);
  window.history.replaceState(null, "", window.location.pathname);
  return fragmentTokens.get(window.location.pathname) ?? "";
}

export function MagicPage() {
  const navigate = useNavigate();
  const token = useRef(fragmentToken());
  const started = useRef(false);
  const [error, setError] = useState(
    token.current
      ? ""
      : "The link did not contain a token. Request a new link.",
  );
  useEffect(() => {
    if (started.current || !token.current) return;
    started.current = true;
    const rawToken = token.current;
    token.current = "";
    fragmentTokens.delete(window.location.pathname);
    async function redeem(): Promise<void> {
      try {
        const response = await api<{
          scope: "person" | "mailbox";
          profiles: { id: string; displayName: string }[];
          pendingDisplayName: string | null;
          csrfToken: string;
        }>("/api/public/magic-links/redeem", {
          method: "POST",
          body: JSON.stringify({ token: rawToken }),
        });
        setMemberCsrf(response.csrfToken);
        void navigate(
          response.scope === "mailbox" ? "/choose-profile" : "/member",
          {
            replace: true,
            state: response,
          },
        );
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "This link could not be used.",
        );
      }
    }
    void redeem();
  }, [navigate]);
  if (!error) return <Loading message="Opening your secure link…" />;
  return (
    <div className="narrow">
      <h1>This link could not be opened</h1>
      <Notice tone="warning">
        <p>{error}</p>
      </Notice>
      <p>
        <Link to="/">Request a new link</Link>
      </p>
    </div>
  );
}

export function ChooseProfilePage() {
  const config = useConfig();
  const location = useLocation();
  const navigate = useNavigate();
  const supplied = location.state as {
    profiles?: { id: string; displayName: string }[];
    pendingDisplayName?: string | null;
  } | null;
  const [profiles, setProfiles] = useState(supplied?.profiles ?? []);
  const [newName, setNewName] = useState(supplied?.pendingDisplayName ?? "");
  const [loading, setLoading] = useState(!supplied);
  const [busyProfileId, setBusyProfileId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const nameDialog = useRef<HTMLDialogElement>(null);
  const consentDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (supplied) return;
    getMemberSession<MemberSessionResponse>()
      .then((response) => {
        setProfiles(response.profiles);
      })
      .catch((caught: unknown) =>
        setError(
          caught instanceof Error ? caught.message : "Your session expired.",
        ),
      )
      .finally(() => setLoading(false));
  }, [supplied]);
  async function select(personId: string): Promise<void> {
    setBusyProfileId(personId);
    setError("");
    try {
      const response = await api<{ currentProfile: string | null }>(
        "/api/member/profiles/select",
        {
          method: "POST",
          csrf: "member",
          body: JSON.stringify({ personId }),
        },
      );
      void navigate("/member/interview", {
        state: response.currentProfile
          ? { currentProfile: response.currentProfile }
          : undefined,
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "That profile could not be opened.",
      );
      setBusyProfileId("");
    }
  }
  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setCreating(true);
    setError("");
    try {
      await api("/api/member/profiles/create", {
        method: "POST",
        csrf: "member",
        body: JSON.stringify({
          displayName: newName,
          adultConfirmed: data.get("adultConfirmed") === "on",
          disclosureAcknowledged: data.get("disclosureAcknowledged") === "on",
          consentVersion: CONSENT_VERSION,
        }),
      });
      consentDialog.current?.close();
      void navigate("/member/interview");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "A new profile could not be started.",
      );
      setCreating(false);
    }
  }
  if (loading) return <Loading message="Loading your profiles…" />;
  return (
    <div className="narrow">
      <h1>Choose a profile</h1>
      <Notice tone="warning">
        <p>
          Anyone with access to this shared mailbox may be able to open the
          profiles associated with it.
        </p>
      </Notice>
      {profiles.length > 0 && (
        <ul className="profile-choice-list">
          {profiles.map((profile) => (
            <li key={profile.id}>
              <button
                className="choice-button"
                disabled={Boolean(busyProfileId) || creating}
                onClick={() => void select(profile.id)}
              >
                {busyProfileId === profile.id
                  ? "Opening…"
                  : `Continue as ${profile.displayName}`}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        className="button secondary"
        disabled={Boolean(busyProfileId) || creating}
        onClick={() => {
          setError("");
          nameDialog.current?.showModal();
        }}
      >
        Create New User
      </button>
      <dialog
        className="profile-dialog"
        ref={nameDialog}
        aria-labelledby="new-user-title"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const trimmedName = newName.trim();
            if (!trimmedName) return;
            setNewName(trimmedName);
            nameDialog.current?.close();
            consentDialog.current?.showModal();
          }}
        >
          <h2 id="new-user-title">Create New User</h2>
          <div className="field">
            <label htmlFor="new-name">Your name</label>
            <input
              id="new-name"
              value={newName}
              maxLength={100}
              required
              autoComplete="name"
              autoFocus
              disabled={creating}
              onChange={(event) => setNewName(event.target.value)}
            />
          </div>
          <div className="button-row">
            <button className="button primary" disabled={!newName.trim()}>
              OK
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => nameDialog.current?.close()}
            >
              Cancel
            </button>
          </div>
        </form>
      </dialog>
      <dialog
        className="profile-dialog"
        ref={consentDialog}
        aria-labelledby="new-user-consent-title"
        onClose={() => setCreating(false)}
      >
        <form onSubmit={(event) => void create(event)}>
          <h2 id="new-user-consent-title">Before you create your profile</h2>
          <p>{config.disclosure.title}</p>
          <label className="check">
            <input
              name="adultConfirmed"
              type="checkbox"
              required
              disabled={creating}
            />
            <span>I confirm that I am at least 18 years old.</span>
          </label>
          <label className="check">
            <input
              name="disclosureAcknowledged"
              type="checkbox"
              required
              disabled={creating}
            />
            <span>
              I have read and acknowledge how Gifts in Service uses my
              information, as described in the{" "}
              <Link to="/privacy" target="_blank" rel="noreferrer">
                Privacy Notice
              </Link>
              .
            </span>
          </label>
          <div className="button-row">
            <button className="button primary" disabled={creating}>
              {creating ? "Creating…" : "Create Profile"}
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={creating}
              onClick={() => consentDialog.current?.close()}
            >
              Cancel
            </button>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </form>
      </dialog>
      {error && !nameDialog.current?.open && !consentDialog.current?.open && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function useMember(): {
  data: MemberSessionResponse | null;
  error: string;
  refresh: () => void;
} {
  const [data, setData] = useState<MemberSessionResponse | null>(null);
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let active = true;
    getMemberSession<MemberSessionResponse>()
      .then((response) => {
        if (active) {
          setData(response);
        }
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error ? caught.message : "Your session expired.",
          );
      });
    return () => {
      active = false;
    };
  }, [generation]);
  return { data, error, refresh: () => setGeneration((value) => value + 1) };
}

export function MemberPage() {
  const { data, error, refresh } = useMember();
  const location = useLocation();
  const navigate = useNavigate();
  const savedOnArrival = profileWasJustSaved(location.state);
  const [showProfileSavedNotice] = useState(savedOnArrival);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (savedOnArrival) {
      void navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, navigate, savedOnArrival]);
  if (error)
    return (
      <div className="narrow">
        <h1>Session expired</h1>
        <Notice tone="warning">
          <p>{error}</p>
        </Notice>
        <Link to="/">Request a new link</Link>
      </div>
    );
  if (!data) return <Loading message="Starting your profile…" />;
  if (!data.person) return <ChooseProfilePage />;
  const person = data.person;
  if (!person.approvedText)
    return (
      <div className="narrow">
        <h1>Ready to begin?</h1>
        <p>
          The conversation usually takes 5–12 short turns. Your unfinished
          questions and answers are saved for up to 30 days so you can return
          later.
        </p>
        <button
          className="button primary"
          onClick={() => void navigate("/member/interview")}
        >
          Begin the conversation
        </button>
      </div>
    );
  async function action(path: string, confirmation: string): Promise<void> {
    try {
      await api(path, { method: "POST", csrf: "member", body: "{}" });
      setMessage(confirmation);
      void refresh();
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "The action failed.",
      );
    }
  }
  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Your approved profile</p>
          <h1>{person.displayName}</h1>
        </div>
        <span className={`status status-${person.status.toLowerCase()}`}>
          {person.status.replaceAll("_", " ")}
        </span>
      </div>
      {showProfileSavedNotice && (
        <Notice tone="success">
          <p>{PROFILE_SAVED_NOTICE}</p>
        </Notice>
      )}
      {message && (
        <Notice>
          <p>{message}</p>
        </Notice>
      )}
      <article className="profile-prose">
        <h2>Exact profile shared with authorized staff</h2>
        <p>{person.approvedText}</p>
      </article>
      {person.status === "INACTIVE_STALE" && person.scheduledPurgeAt && (
        <Notice tone="warning">
          <p>
            This profile is hidden from search and scheduled for permanent
            removal on{" "}
            {new Intl.DateTimeFormat("en-US", {
              dateStyle: "long",
              timeZone: "America/Chicago",
            }).format(new Date(person.scheduledPurgeAt))}
            .
          </p>
        </Notice>
      )}
      <section className="confirmation">
        <h2>Is this still accurate?</h2>
        <div className="button-row">
          <button
            className="button primary large"
            onClick={() =>
              void action(
                "/api/member/profile/verify",
                "Your profile was reconfirmed.",
              )
            }
          >
            That Looks Right
          </button>
          <button
            className="button secondary large"
            onClick={() =>
              void navigate("/member/interview", {
                state: { currentProfile: person.approvedText },
              })
            }
          >
            Let Me Update This
          </button>
        </div>
      </section>
      <section>
        <h2>Profile controls</h2>
        <div className="button-row">
          {person.status === "PAUSED" ? (
            <button
              className="button secondary"
              onClick={() =>
                void action(
                  "/api/member/profile/reactivate",
                  "Your profile is active again.",
                )
              }
            >
              Reactivate profile
            </button>
          ) : (
            <button
              className="button secondary"
              onClick={() =>
                void action(
                  "/api/member/profile/pause",
                  "Your profile is paused and hidden from staff search.",
                )
              }
            >
              Pause profile
            </button>
          )}
          <Link className="button secondary" to="/member/emails">
            Manage name and emails
          </Link>
          <Link
            className="button danger profile-control-delete"
            to="/member/delete"
          >
            Delete Profile
          </Link>
        </div>
      </section>
    </div>
  );
}

interface DraftState {
  profile_text: string;
  coverage_notes: string;
  approvalToken: string;
  consentVersion: string;
  promptVersion: string;
}

interface PendingInterviewResponse {
  messages: InterviewMessage[];
  proposedProfile: string | null;
  completenessConfidence: InterviewCompleteness;
  revision: number;
  currentProfile: string | null;
  startedAt: string;
  expiresAt: string;
}

type InterviewTurnResponse =
  | { saved: true }
  | {
      saved: false;
      deletionRequested: boolean;
      message: string;
      revision: number;
      proposedProfile: string | null;
      completenessConfidence: InterviewCompleteness;
    };

export function InterviewPage() {
  const config = useConfig();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<InterviewMessage[]>([]);
  const [proposedProfile, setProposedProfile] = useState<string | null>(null);
  const [completenessConfidence, setCompletenessConfidence] =
    useState<InterviewCompleteness>("LOW");
  const [revision, setRevision] = useState<number | null>(null);
  const [currentProfile, setCurrentProfile] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    let active = true;
    getMemberSession<MemberSessionResponse>()
      .then(() =>
        api<PendingInterviewResponse>("/api/member/interview/start", {
          method: "POST",
          csrf: "member",
          body: "{}",
        }),
      )
      .then((response) => {
        if (!active) return;
        setMessages(response.messages);
        setProposedProfile(response.proposedProfile);
        setCompletenessConfidence(response.completenessConfidence);
        setRevision(response.revision);
        setCurrentProfile(response.currentProfile);
        setExpiresAt(response.expiresAt);
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "The conversation could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  useEffect(() => {
    if (!loading && !busy && messages.length > 0) {
      inputRef.current?.focus();
    }
  }, [busy, loading, messages.length]);
  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const responseText = input.trim();
    if (busy || !responseText || revision === null) return;
    const previousMessages = messages;
    const next = [
      ...messages,
      { role: "user" as const, content: responseText },
    ];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError("");
    try {
      const response = await api<InterviewTurnResponse>(
        "/api/member/interview/message",
        {
          method: "POST",
          csrf: "member",
          body: JSON.stringify({ response: responseText, revision }),
        },
      );
      if (response.saved) {
        void navigate("/member", {
          replace: true,
          state: PROFILE_SAVED_NAVIGATION_STATE,
        });
        return;
      }
      setMessages([...next, { role: "assistant", content: response.message }]);
      setRevision(response.revision);
      setProposedProfile(response.proposedProfile);
      setCompletenessConfidence(response.completenessConfidence);
      if (response.deletionRequested) {
        void navigate("/member/delete");
        return;
      }
    } catch (caught) {
      setMessages(previousMessages);
      setInput(responseText);
      setError(
        caught instanceof Error
          ? caught.message
          : "The assistant could not respond.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submitProposedProfile(): Promise<void> {
    if (busy || revision === null || !proposedProfile) return;
    setBusy(true);
    setSubmitting(true);
    setError("");
    try {
      await api("/api/member/interview/submit", {
        method: "POST",
        csrf: "member",
        body: JSON.stringify({ revision }),
      });
      void navigate("/member", {
        replace: true,
        state: PROFILE_SAVED_NAVIGATION_STATE,
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The exact proposed profile could not be submitted.",
      );
    } finally {
      setSubmitting(false);
      setBusy(false);
    }
  }
  async function draft(): Promise<void> {
    if (revision === null) return;
    setBusy(true);
    setError("");
    try {
      const response = await api<Omit<DraftState, "messages">>(
        "/api/member/interview/draft",
        {
          method: "POST",
          csrf: "member",
          body: JSON.stringify({ revision }),
        },
      );
      void navigate("/member/review", {
        state: response satisfies DraftState,
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "A safe draft could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <Loading message="Loading your conversation…" />;
  if (messages.length === 0)
    return (
      <div className="narrow">
        <h1>Conversation unavailable</h1>
        <Notice tone="warning">
          <p>{error || "The conversation could not be loaded."}</p>
        </Notice>
        <Link to="/">Request a new secure link</Link>
      </div>
    );
  return (
    <div className="chat-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Private active-session conversation</p>
          <h1>
            {currentProfile
              ? "Update your profile"
              : "Tell us about your gifts"}
          </h1>
        </div>
      </div>
      <Notice>
        <p>
          Your unfinished questions and answers are saved securely until you
          approve your profile or for 30 days from the start of this
          conversation
          {expiresAt
            ? ` (${new Intl.DateTimeFormat("en-US", {
                dateStyle: "long",
                timeStyle: "short",
                timeZone: "America/Chicago",
              }).format(new Date(expiresAt))})`
            : ""}
          . Do not enter private credentials, account numbers, identification
          numbers, diagnoses, or details about other people.
        </p>
      </Notice>
      {currentProfile && (
        <article
          className="profile-prose"
          aria-labelledby="current-profile-heading"
        >
          <h2 id="current-profile-heading">Your current profile</h2>
          <p>{currentProfile}</p>
        </article>
      )}
      <ol className="chat" aria-live="polite" aria-label="Conversation">
        {messages.map((message, index) => (
          <li
            className={`chat-message ${message.role}`}
            key={`${index}-${message.role}`}
          >
            <span className="speaker">
              {message.role === "assistant" ? "Gifts in Service" : "You"}
            </span>
            <p>{message.content}</p>
          </li>
        ))}
      </ol>
      <div ref={endRef} />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {proposedProfile && (
        <section className="disclosure" aria-label="Profile submission terms">
          {config.approvalDisclosure.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          <p>
            Selecting <strong>Submit profile</strong>, or clearly asking the
            assistant to submit it, saves the exact proposed profile shown in
            the conversation.
          </p>
        </section>
      )}
      <form className="chat-form" onSubmit={(event) => void send(event)}>
        <label htmlFor="chat-input">Your response</label>
        <textarea
          id="chat-input"
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          aria-describedby="chat-input-help"
          maxLength={3000}
          rows={4}
          disabled={busy}
          required
        />
        <span id="chat-input-help" className="field-help">
          {proposedProfile
            ? "Press Enter to request changes or ask the assistant to submit this profile. Press Shift+Enter for a new line."
            : completenessConfidence === "LOW"
              ? "Press Enter to send. The draft option will become available once the conversation has enough detail; you can also ask to wrap up at any time. Press Shift+Enter for a new line."
              : "Press Enter to send, or create a draft if you are ready to wrap up. Press Shift+Enter for a new line."}
        </span>
        <div className="button-row">
          <button
            className={`button ${proposedProfile ? "secondary" : "primary"}`}
            disabled={busy || !input.trim()}
          >
            {busy && !submitting ? "Thinking…" : "Send response"}
          </button>
          {proposedProfile && (
            <button
              className="button primary"
              type="button"
              disabled={busy}
              onClick={() => void submitProposedProfile()}
            >
              {submitting ? "Submitting profile…" : "Submit profile"}
            </button>
          )}
          <button
            className="button secondary"
            type="button"
            disabled={
              busy ||
              messages.length < 3 ||
              completenessConfidence === "LOW" ||
              Boolean(proposedProfile)
            }
            onClick={() => void draft()}
          >
            Create a draft
          </button>
          <button
            className="button danger profile-control-delete"
            type="button"
            disabled={busy}
            onClick={() => void navigate("/member/delete")}
          >
            Delete Profile
          </button>
        </div>
      </form>
    </div>
  );
}

export function ReviewPage() {
  const config = useConfig();
  const navigate = useNavigate();
  const state = useLocation().state as DraftState | null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!state)
    return (
      <div className="narrow">
        <h1>Draft no longer available</h1>
        <p>
          Drafts stay only in memory. Your pending questions and answers remain
          available for up to 30 days, so you can return to the conversation and
          make a new draft.
        </p>
        <Link to="/member/interview">Return to conversation</Link>
      </div>
    );
  const draft = state;
  async function approve(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await api("/api/member/profile/approve", {
        method: "POST",
        csrf: "member",
        body: JSON.stringify({
          profileText: draft.profile_text,
          approvalToken: draft.approvalToken,
          consentVersion: draft.consentVersion,
        }),
      });
      void navigate("/member", {
        replace: true,
        state: PROFILE_SAVED_NAVIGATION_STATE,
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The exact profile could not be saved.",
      );
      setBusy(false);
    }
  }
  return (
    <div className="narrow">
      <p className="eyebrow">Final review</p>
      <h1>{config.approvalDisclosure.title}</h1>
      <p>{state.coverage_notes}</p>
      <article
        className="profile-prose exact-review"
        aria-label="Exact proposed profile"
      >
        <p>{state.profile_text}</p>
      </article>
      <section className="disclosure">
        {config.approvalDisclosure.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </section>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="review-actions">
        <button
          className="button primary large"
          disabled={busy}
          onClick={() => void approve()}
        >
          {busy ? "Saving exact profile…" : "Approve and Save"}
        </button>
        <button
          className="button secondary"
          onClick={() => void navigate("/member/interview")}
        >
          Make Changes
        </button>
        <Link className="button danger" to="/member/delete">
          Delete and Exit
        </Link>
      </div>
    </div>
  );
}

export function EmailManagementPage() {
  const { data, error, refresh } = useMember();
  const [notice, setNotice] = useState("");
  if (error)
    return (
      <Notice tone="warning">
        <p>{error}</p>
      </Notice>
    );
  if (!data?.person) return <Loading />;
  async function add(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      await api("/api/member/emails", {
        method: "POST",
        csrf: "member",
        body: JSON.stringify({ email: values.get("email") }),
      });
      form.reset();
      setNotice(
        "A verification link was sent to the new address. It is not active yet.",
      );
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "The address could not be added.",
      );
    }
  }
  async function rename(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    try {
      await api("/api/member/name", {
        method: "POST",
        csrf: "member",
        body: JSON.stringify({ displayName: values.get("displayName") }),
      });
      setNotice("Display name updated.");
      void refresh();
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "The name could not be updated.",
      );
    }
  }
  async function remove(id: string): Promise<void> {
    try {
      await api(`/api/member/emails/${id}`, {
        method: "DELETE",
        csrf: "member",
      });
      setNotice("Email association removed.");
      void refresh();
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "The address cannot be removed until another verified address exists.",
      );
    }
  }
  async function makePrimary(id: string): Promise<void> {
    try {
      await api(`/api/member/emails/${id}/primary`, {
        method: "POST",
        csrf: "member",
        body: "{}",
      });
      setNotice("Primary email updated.");
      void refresh();
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "The primary address could not be changed.",
      );
    }
  }
  return (
    <div className="narrow">
      <h1>Manage your name and emails</h1>
      {notice && (
        <Notice>
          <p>{notice}</p>
        </Notice>
      )}
      <form onSubmit={(event) => void rename(event)}>
        <div className="field">
          <label htmlFor="rename">Display name</label>
          <input
            id="rename"
            name="displayName"
            defaultValue={data.person.displayName}
            required
            maxLength={100}
          />
        </div>
        <button className="button secondary">Update name</button>
      </form>
      <section>
        <h2>Verified email associations</h2>
        <ul className="email-list">
          {data.emails.map((email) => (
            <li key={email.id}>
              <div>
                <strong>{email.displayEmail}</strong>
                <span>
                  {email.verifiedAt ? "Verified" : "Pending"} ·{" "}
                  {email.deliverability}
                  {email.isPrimary ? " · Primary" : ""}
                </span>
              </div>
              <div>
                {email.verifiedAt && !email.isPrimary && (
                  <button
                    className="text-button"
                    onClick={() => void makePrimary(email.id)}
                  >
                    Make primary
                  </button>
                )}
                <button
                  className="text-button"
                  disabled={
                    data.emails.filter((item) => item.verifiedAt).length <= 1
                  }
                  onClick={() => void remove(email.id)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
        <form onSubmit={(event) => void add(event)}>
          <div className="field">
            <label htmlFor="new-email">Add another email</label>
            <input
              id="new-email"
              name="email"
              type="email"
              required
              maxLength={254}
            />
          </div>
          <button className="button secondary">Send verification link</button>
        </form>
      </section>
      <p>
        <Link to="/member">Back to profile</Link>
      </p>
    </div>
  );
}

export function VerifyEmailPage() {
  const token = useRef(fragmentToken());
  const [status, setStatus] = useState(
    token.current ? "" : "This link is missing its private token.",
  );
  async function verify(): Promise<void> {
    try {
      await api("/api/member/emails/verify", {
        method: "POST",
        csrf: "member",
        body: JSON.stringify({ token: token.current }),
      });
      token.current = "";
      setStatus("The new email is verified.");
    } catch (caught) {
      setStatus(
        caught instanceof Error
          ? caught.message
          : "This address could not be verified.",
      );
    }
  }
  return (
    <div className="narrow">
      <h1>Verify a new email</h1>
      {status && (
        <Notice>
          <p>{status}</p>
        </Notice>
      )}
      <button
        className="button primary"
        disabled={!token.current}
        onClick={() => void verify()}
      >
        Verify this email
      </button>
      <p>
        <Link to="/member/emails">Return to email settings</Link>
      </p>
    </div>
  );
}

export function DeletePage() {
  const navigate = useNavigate();
  const { data, error: sessionError } = useMember();
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function remove(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await api("/api/member/profile", { method: "DELETE", csrf: "member" });
      void navigate("/", { replace: true, state: { deleted: true } });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Deletion could not be completed.",
      );
      setBusy(false);
    }
  }
  if (sessionError)
    return (
      <div className="narrow">
        <h1>Session expired</h1>
        <Notice tone="warning">
          <p>{sessionError}</p>
        </Notice>
        <Link to="/">Request a new link</Link>
      </div>
    );
  if (!data) return <Loading message="Preparing profile deletion…" />;
  if (!data.person)
    return (
      <div className="narrow">
        <h1>Choose a profile first</h1>
        <Link to="/choose-profile">Choose a profile</Link>
      </div>
    );
  return (
    <div className="narrow">
      <h1>Permanently delete your profile</h1>
      <Notice tone="warning">
        <p>
          This immediately removes the live profile, embedding, contact
          associations, sessions, and pending tokens. A minimal pseudonymous
          purge event remains. Encrypted backups expire on their rotation
          schedule, normally within 35 days.
        </p>
      </Notice>
      <div className="field">
        <label htmlFor="delete-confirmation">Type DELETE to confirm</label>
        <input
          id="delete-confirmation"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <button
          className="button danger"
          disabled={busy || confirmation !== "DELETE"}
          onClick={() => void remove()}
        >
          {busy ? "Deleting…" : "Permanently delete"}
        </button>
        <Link className="button secondary" to="/member">
          Keep my profile
        </Link>
      </div>
    </div>
  );
}

export function RecoveryPage({ title }: { title: string }) {
  return (
    <div className="narrow">
      <h1>{title}</h1>
      <p>For your protection, the link or session can no longer be used.</p>
      <Link className="button primary" to="/">
        Request a new secure link
      </Link>
    </div>
  );
}
