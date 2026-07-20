import { useEffect, useState, type FormEvent } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { api, setStaffCsrf } from "./api.js";
import { Loading, Notice } from "./components.js";
import { useConfig } from "./context.js";
import type { StaffMe } from "./types.js";
import type { StaffGroup } from "@gis/shared";

type StaffAuthChallenge =
  | "NEW_PASSWORD_REQUIRED"
  | "SOFTWARE_TOKEN_MFA"
  | "MFA_SETUP";

type StaffAuthResponse =
  | {
      authenticated: true;
      groups: StaffGroup[];
      permissions: string[];
      csrfToken: string;
    }
  | {
      authenticated: false;
      challenge: StaffAuthChallenge;
      transaction: string;
      secretCode?: string;
    };

function formString(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

function staffDestination(groups: readonly StaffGroup[]): string {
  return groups.includes("gis-technical-admin")
    ? "/staff/health"
    : groups.includes("gis-privacy-auditor") &&
        !groups.some((group) =>
          ["gis-admin", "gis-staff", "gis-ministry-leader"].includes(group),
        )
      ? "/staff/audit"
      : "/staff/search";
}

const groupLabels: Readonly<Record<StaffGroup, string>> = {
  "gis-admin": "Administrator",
  "gis-staff": "Staff",
  "gis-ministry-leader": "Ministry leader",
  "gis-privacy-auditor": "Privacy auditor",
  "gis-technical-admin": "Technical administrator",
};

const centralDateTime = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Chicago",
});

function formatDateTime(value: string | null): string {
  return value ? `${centralDateTime.format(new Date(value))} CT` : "—";
}

function OneTimeCodeField({
  id,
  autoFocus = false,
  submitWhenComplete = false,
}: {
  id: string;
  autoFocus?: boolean;
  submitWhenComplete?: boolean;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>Six-digit code</label>
      <input
        id={id}
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        minLength={6}
        maxLength={6}
        autoFocus={autoFocus}
        onInput={(event) => {
          const input = event.currentTarget;
          const digits = input.value.replace(/\D/gu, "").slice(0, 6);
          if (input.value !== digits) input.value = digits;
          if (submitWhenComplete && digits.length === 6) {
            const form = input.form;
            queueMicrotask(() => {
              if (
                form?.isConnected &&
                input.value === digits &&
                !form.matches(":invalid")
              )
                form.requestSubmit();
            });
          }
        }}
        required
      />
    </div>
  );
}

function PasswordFields({ prefix }: { prefix: string }) {
  return (
    <>
      <div className="field">
        <label htmlFor={`${prefix}-password`}>New password</label>
        <input
          id={`${prefix}-password`}
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={14}
          maxLength={256}
          required
        />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-confirm`}>Confirm new password</label>
        <input
          id={`${prefix}-confirm`}
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={14}
          maxLength={256}
          required
        />
      </div>
    </>
  );
}

function useStaff(): { me: StaffMe | null; error: string } {
  const [me, setMe] = useState<StaffMe | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<StaffMe>("/api/staff/me")
      .then((value) => {
        if (active) {
          setStaffCsrf(value.csrfToken);
          setMe(value);
        }
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error ? caught.message : "Sign in is required.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  return { me, error };
}

function StaffNavigation({ me }: { me: StaffMe }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const links = [
    {
      permission: "profile:search",
      to: "/staff/search",
      label: "Search",
    },
    {
      permission: "profile:pause",
      to: "/staff/profiles",
      label: "Volunteer records",
    },
    {
      permission: "lifecycle:read",
      to: "/staff/lifecycle",
      label: "Lifecycle exceptions",
    },
    {
      permission: "audit:read",
      to: "/staff/audit",
      label: "Audit",
    },
    {
      permission: "access:manage-lower",
      to: "/staff/access",
      label: "Staff access",
    },
    {
      permission: "technical:read",
      to: "/staff/health",
      label: "Technical health",
    },
  ].filter((link) => me.permissions.includes(link.permission));

  async function signOut(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await api("/api/staff/auth/logout", {
        method: "POST",
        csrf: "staff",
        body: "{}",
      });
      setStaffCsrf("");
      void navigate("/staff", { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign out failed.");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="staff-console">
        <div>
          <p className="staff-role">
            Signed in as{" "}
            {me.groups.map((group) => groupLabels[group]).join(", ")}
          </p>
          <nav className="staff-console-nav" aria-label="Staff console">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to}>
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={() => void signOut()}
        >
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </div>
      {error && (
        <Notice tone="warning">
          <p>{error}</p>
        </Notice>
      )}
    </>
  );
}

export function StaffLandingPage() {
  const config = useConfig();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<
    "login" | "challenge" | "forgot-request" | "forgot-confirm"
  >("login");
  const [email, setEmail] = useState("");
  const [challenge, setChallenge] = useState<StaffAuthChallenge | null>(null);
  const [transaction, setTransaction] = useState("");
  const [secretCode, setSecretCode] = useState("");
  const [qrCode, setQrCode] = useState("");

  useEffect(() => {
    let active = true;
    if (challenge !== "MFA_SETUP" || !secretCode) {
      setQrCode("");
      return;
    }
    const issuer = config.appName;
    const label = `${issuer}:${email.trim().toLowerCase()}`;
    const uri = `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(secretCode)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    void QRCode.toDataURL(uri, {
      width: 240,
      margin: 1,
      errorCorrectionLevel: "M",
    })
      .then((value) => {
        if (active) setQrCode(value);
      })
      .catch(() => {
        if (active) setError("The authenticator QR code could not be created.");
      });
    return () => {
      active = false;
    };
  }, [challenge, config.appName, email, secretCode]);

  function finishSignIn(response: StaffAuthResponse): void {
    if (response.authenticated) {
      setStaffCsrf(response.csrfToken);
      void navigate(staffDestination(response.groups));
      return;
    }
    setChallenge(response.challenge);
    setTransaction(response.transaction);
    setSecretCode(response.secretCode ?? "");
    setMode("challenge");
  }

  function startOver(): void {
    setMode("login");
    setChallenge(null);
    setTransaction("");
    setSecretCode("");
    setQrCode("");
    setError("");
  }

  async function cognitoSignIn(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      finishSignIn(
        await api<StaffAuthResponse>("/api/staff/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email,
            password: data.get("password"),
          }),
        }),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Staff sign-in failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function answerChallenge(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!challenge) return;
    const data = new FormData(event.currentTarget);
    const response =
      challenge === "NEW_PASSWORD_REQUIRED"
        ? formString(data, "newPassword")
        : formString(data, "code").replaceAll(/\s/gu, "");
    if (
      challenge === "NEW_PASSWORD_REQUIRED" &&
      response !== data.get("confirmPassword")
    ) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      finishSignIn(
        await api<StaffAuthResponse>("/api/staff/auth/challenge", {
          method: "POST",
          body: JSON.stringify({ transaction, response }),
        }),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The sign-in step could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function requestPasswordReset(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await api<{ message: string; transaction: string }>(
        "/api/staff/auth/forgot-password",
        {
          method: "POST",
          body: JSON.stringify({ email }),
        },
      );
      setTransaction(response.transaction);
      setNotice(response.message);
      setMode("forgot-confirm");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The password reset could not be started.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmPasswordReset(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const newPassword = formString(data, "newPassword");
    if (newPassword !== data.get("confirmPassword")) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/staff/auth/confirm-password", {
        method: "POST",
        body: JSON.stringify({
          transaction,
          code: formString(data, "code").replaceAll(/\s/gu, ""),
          newPassword,
        }),
      });
      startOver();
      setNotice("Your password was reset. You can now sign in.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The password could not be reset.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function signIn(group: StaffGroup): Promise<void> {
    setBusy(true);
    try {
      const response = await api<StaffMe>("/api/staff/auth/fake", {
        method: "POST",
        body: JSON.stringify({ groups: [group] }),
      });
      setStaffCsrf(response.csrfToken);
      void navigate(staffDestination([group]));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Staff sign-in is not available.",
      );
      setBusy(false);
    }
  }
  if (config.staffAuthMode === "cognito") {
    return (
      <div className="narrow">
        <p className="eyebrow">Authorized workforce access</p>
        <h1>Staff sign in</h1>
        <p>
          Sign in with your church staff account. Cognito verifies your password
          and authenticator code without taking you away from this page. Gifts
          in Service does not store your password.
        </p>
        {error && (
          <Notice tone="warning">
            <p>{error}</p>
          </Notice>
        )}
        {notice && (
          <Notice tone="success">
            <p>{notice}</p>
          </Notice>
        )}
        {mode === "login" && (
          <form
            className="staff-auth-card"
            onSubmit={(event) => void cognitoSignIn(event)}
          >
            <div className="field">
              <label htmlFor="staff-email">Staff email address</label>
              <input
                id="staff-email"
                name="email"
                type="email"
                autoComplete="username"
                maxLength={254}
                required
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="staff-password">Password</label>
              <input
                id="staff-password"
                name="password"
                type="password"
                autoComplete="current-password"
                maxLength={256}
                required
              />
            </div>
            <div className="button-row">
              <button className="button primary large" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setError("");
                  setNotice("");
                  setMode("forgot-request");
                }}
              >
                Forgot password?
              </button>
            </div>
          </form>
        )}
        {mode === "challenge" && challenge && (
          <form
            className="staff-auth-card"
            onSubmit={(event) => void answerChallenge(event)}
          >
            {challenge === "NEW_PASSWORD_REQUIRED" ? (
              <>
                <h2>Choose a permanent password</h2>
                <p>
                  Use at least 14 characters with uppercase and lowercase
                  letters, a number, and a symbol.
                </p>
                <PasswordFields prefix="staff-challenge" />
              </>
            ) : (
              <>
                <h2>
                  {challenge === "MFA_SETUP"
                    ? "Set up your authenticator"
                    : "Enter your authenticator code"}
                </h2>
                {challenge === "MFA_SETUP" && (
                  <>
                    <p>
                      Scan this QR code with your authenticator app, or enter
                      the setup key manually. Then enter the current six-digit
                      code.
                    </p>
                    {qrCode && (
                      <img
                        className="totp-qr"
                        src={qrCode}
                        alt="QR code for authenticator setup"
                      />
                    )}
                    <p className="setup-key">
                      Setup key: <code>{secretCode}</code>
                    </p>
                  </>
                )}
                <OneTimeCodeField
                  id="staff-auth-code"
                  autoFocus
                  submitWhenComplete
                />
              </>
            )}
            <div className="button-row">
              <button className="button primary large" disabled={busy}>
                {busy ? "Verifying…" : "Continue"}
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={startOver}
              >
                Start over
              </button>
            </div>
          </form>
        )}
        {mode === "forgot-request" && (
          <form
            className="staff-auth-card"
            onSubmit={(event) => void requestPasswordReset(event)}
          >
            <h2>Reset your password</h2>
            <div className="field">
              <label htmlFor="reset-email">Staff email address</label>
              <input
                id="reset-email"
                name="email"
                type="email"
                autoComplete="username"
                maxLength={254}
                required
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
              />
            </div>
            <div className="button-row">
              <button className="button primary" disabled={busy}>
                {busy ? "Requesting…" : "Send reset code"}
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={startOver}
              >
                Back to sign in
              </button>
            </div>
          </form>
        )}
        {mode === "forgot-confirm" && (
          <form
            className="staff-auth-card"
            onSubmit={(event) => void confirmPasswordReset(event)}
          >
            <h2>Enter the reset code</h2>
            <OneTimeCodeField id="staff-reset-code" />
            <PasswordFields prefix="staff-reset" />
            <div className="button-row">
              <button className="button primary" disabled={busy}>
                {busy ? "Resetting…" : "Reset password"}
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={startOver}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }
  return (
    <div className="narrow">
      <p className="eyebrow">Authorized workforce access</p>
      <h1>Staff sign in</h1>
      <p>
        Production uses an in-page Cognito sign-in with TOTP MFA. The choices
        below are clearly marked local-development role simulations and are
        disabled by production configuration.
      </p>
      {error && (
        <Notice tone="warning">
          <p>{error}</p>
        </Notice>
      )}
      <div className="role-grid">
        {(
          [
            "gis-admin",
            "gis-staff",
            "gis-ministry-leader",
            "gis-privacy-auditor",
            "gis-technical-admin",
          ] as const
        ).map((group) => (
          <button
            className="choice-button"
            disabled={busy}
            key={group}
            onClick={() => void signIn(group)}
          >
            {group}
            <span>Local fake sign-in</span>
          </button>
        ))}
      </div>
    </div>
  );
}

interface SearchResult {
  personId: string;
  approvedText: string;
  relevance: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
  evidence: string[];
  cautions: string[];
  explanationGeneratedByAi: boolean;
}

export function StaffSearchPage() {
  const { me, error: authError } = useStaff();
  const [results, setResults] = useState<SearchResult[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  if (authError) return <AccessDenied message={authError} />;
  if (!me) return <Loading message="Checking staff access…" />;
  if (!me.permissions.includes("profile:search"))
    return (
      <AccessDenied message="This role cannot search volunteer profiles." />
    );
  async function search(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setNotice("");
    try {
      const response = await api<{
        results: SearchResult[];
        suggestionNotice: string;
      }>("/api/staff/search", {
        method: "POST",
        csrf: "staff",
        body: JSON.stringify({ query: values.get("query") }),
      });
      setResults(response.results);
      setNotice(response.suggestionNotice);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <StaffNavigation me={me} />
      <p className="eyebrow">Self-reported profile search</p>
      <h1>Who might be able to help?</h1>
      <p>
        Describe the need in natural language. Results are suggestions, not
        verification or assignments.
      </p>
      <form className="search-form" onSubmit={(event) => void search(event)}>
        <label htmlFor="staff-query">
          What kind of experience or help are you looking for?
        </label>
        <textarea
          id="staff-query"
          name="query"
          required
          minLength={3}
          maxLength={1000}
          rows={4}
          placeholder="Someone who can maintain a WordPress site and improve accessibility."
        />
        <button className="button primary large" disabled={busy}>
          {busy ? "Finding possible matches…" : "Search approved profiles"}
        </button>
      </form>
      <details>
        <summary>Query examples</summary>
        <ul>
          <li>
            Who could help us understand intermittent problems with an older
            commercial air-conditioning unit?
          </li>
          <li>
            A retired elementary teacher who might mentor a new Sunday School
            teacher.
          </li>
          <li>
            Someone with nonprofit accounting and internal-control experience,
            but do not assume they can perform an independent audit.
          </li>
        </ul>
      </details>
      {notice && (
        <Notice>
          <p>{notice}</p>
        </Notice>
      )}
      <section aria-live="polite" aria-busy={busy}>
        <h2>
          {results.length
            ? `${results.length} possible matches`
            : "Search results"}
        </h2>
        <div className="result-grid">
          {results.map((result) => (
            <article className="result-card" key={result.personId}>
              <div className="result-heading">
                <span className="status">{result.relevance}</span>
                <span>
                  {result.explanationGeneratedByAi
                    ? "AI-generated explanation"
                    : "Deterministic explanation"}
                </span>
              </div>
              <p className="reason">{result.reason}</p>
              {result.evidence.length > 0 && (
                <div>
                  <h3>Exact evidence</h3>
                  {result.evidence.map((evidence) => (
                    <blockquote key={evidence}>{evidence}</blockquote>
                  ))}
                </div>
              )}
              <details>
                <summary>Show full approved profile</summary>
                <p>{result.approvedText}</p>
              </details>
              {result.cautions.map((caution) => (
                <p className="caution" key={caution}>
                  {caution}
                </p>
              ))}
              <Link
                className="text-link"
                to={`/staff/profiles/${result.personId}`}
              >
                View profile and contact details
              </Link>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export function StaffProfilePage() {
  const { id: personId = "" } = useParams();
  const navigate = useNavigate();
  const { me, error: authError } = useStaff();
  const [data, setData] = useState<StaffProfileData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(): Promise<void> {
    setData(await api<StaffProfileData>(`/api/staff/profiles/${personId}`));
  }

  useEffect(() => {
    if (!me?.permissions.includes("profile:read")) return;
    void api<StaffProfileData>(`/api/staff/profiles/${personId}`)
      .then((response) => setData(response))
      .catch((caught: unknown) =>
        setError(
          caught instanceof Error ? caught.message : "Profile not found.",
        ),
      );
  }, [me, personId]);

  async function setStatus(action: "pause" | "reactivate"): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await api(`/api/staff/profiles/${personId}/${action}`, {
        method: "POST",
        csrf: "staff",
        body: "{}",
      });
      setNotice(
        action === "pause"
          ? "The profile is paused and no longer appears in search."
          : "The profile is active and appears in search.",
      );
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The status update failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function purge(): Promise<void> {
    if (
      !window.confirm(
        `Permanently delete ${data?.person.displayName ?? "this volunteer record"}, including its profile and contact associations? This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/staff/profiles/${personId}`, {
        method: "DELETE",
        csrf: "staff",
      });
      void navigate("/staff/profiles", {
        replace: true,
        state: { notice: "Volunteer record permanently deleted." },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Deletion failed.");
      setBusy(false);
    }
  }

  if (authError) return <AccessDenied message={authError} />;
  if (!me) return <Loading message="Checking staff access…" />;
  if (!me.permissions.includes("profile:read"))
    return <AccessDenied message="This role cannot view volunteer profiles." />;
  if (error && !data) return <AccessDenied message={error} />;
  if (!data) return <Loading />;
  const canPause = me.permissions.includes("profile:pause");
  const canReactivate = me.permissions.includes("profile:reactivate");
  const canPurge = me.permissions.includes("profile:purge");
  return (
    <div>
      <StaffNavigation me={me} />
      {notice && (
        <Notice tone="success">
          <p>{notice}</p>
        </Notice>
      )}
      {error && (
        <Notice tone="warning">
          <p>{error}</p>
        </Notice>
      )}
      <p className="eyebrow">Authorized staff view</p>
      <div className="page-heading">
        <div>
          <h1>{data.person.displayName}</h1>
          <span
            className={`status status-${data.person.status.toLocaleLowerCase("en-US")}`}
          >
            {data.person.status.replaceAll("_", " ")}
          </span>
        </div>
        <Link
          to={canPause ? "/staff/profiles" : "/staff/search"}
          className="button secondary"
        >
          {canPause ? "Back to volunteer records" : "Back to search"}
        </Link>
      </div>
      <Notice tone="warning">
        <p>{data.selfReportedNotice}</p>
      </Notice>
      <article className="profile-prose">
        <h2>Exact approved profile</h2>
        <p>
          {data.person.approvedText ??
            "This person has not submitted an approved profile."}
        </p>
      </article>
      {me.permissions.includes("contact:read") && (
        <section>
          <h2>Verified contact associations</h2>
          {data.emails.length ? (
            <ul>
              {data.emails.map((email) => (
                <li key={email.displayEmail}>
                  {email.displayEmail} —{" "}
                  {email.deliverability.replaceAll("_", " ").toLowerCase()}
                </li>
              ))}
            </ul>
          ) : (
            <p>No verified contact association is available.</p>
          )}
          <p>
            Contacting a person does not assign them or commit them to serve.
          </p>
        </section>
      )}
      {(canPause || canReactivate || canPurge) && (
        <section className="admin-actions">
          <h2>Administrative actions</h2>
          <p>
            Pause removes the profile from search without deleting it. Permanent
            deletion removes the live volunteer record and cannot be undone.
          </p>
          <div className="button-row">
            {canPause && data.person.status === "ACTIVE" && (
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => void setStatus("pause")}
              >
                Pause profile
              </button>
            )}
            {canReactivate &&
              data.person.status !== "ACTIVE" &&
              Boolean(data.person.approvedText) && (
                <button
                  className="button primary"
                  type="button"
                  disabled={busy}
                  onClick={() => void setStatus("reactivate")}
                >
                  Reactivate profile
                </button>
              )}
            {canPurge && (
              <button
                className="button danger"
                type="button"
                disabled={busy}
                onClick={() => void purge()}
              >
                Permanently delete record
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

interface StaffProfileData {
  person: {
    displayName: string;
    status: string;
    approvedText: string | null;
    contentUpdatedAt: string | null;
    lastVerifiedAt: string | null;
    scheduledPurgeAt: string | null;
  };
  emails: { displayEmail: string; deliverability: string }[];
  selfReportedNotice: string;
}

interface StaffPersonRecord {
  id: string;
  displayName: string;
  status: string;
  hasApprovedProfile: boolean;
  contentUpdatedAt: string | null;
  lastVerifiedAt: string | null;
  scheduledPurgeAt: string | null;
  primaryEmail: string | null;
  deliverability: string | null;
}

export function StaffRecordsPage() {
  const { me, error: authError } = useStaff();
  const [people, setPeople] = useState<StaffPersonRecord[]>([]);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!me?.permissions.includes("profile:pause")) return;
    void api<{ people: StaffPersonRecord[] }>("/api/staff/profiles")
      .then((response) => setPeople(response.people))
      .catch((caught: unknown) =>
        setError(
          caught instanceof Error
            ? caught.message
            : "Volunteer records could not be loaded.",
        ),
      );
  }, [me]);

  if (authError) return <AccessDenied message={authError} />;
  if (!me) return <Loading message="Checking staff access…" />;
  if (!me.permissions.includes("profile:pause"))
    return (
      <AccessDenied message="This role cannot administer volunteer records." />
    );
  const normalizedFilter = filter.trim().toLocaleLowerCase("en-US");
  const visible = people.filter((person) =>
    [person.displayName, person.primaryEmail ?? "", person.status].some(
      (value) => value.toLocaleLowerCase("en-US").includes(normalizedFilter),
    ),
  );
  return (
    <div>
      <StaffNavigation me={me} />
      <p className="eyebrow">Administrator controls</p>
      <h1>Volunteer records</h1>
      <p>
        Review active, paused, stale, and incomplete records. Open a record to
        pause, reactivate, or permanently delete it.
      </p>
      {error && (
        <Notice tone="warning">
          <p>{error}</p>
        </Notice>
      )}
      <div className="field record-filter">
        <label htmlFor="record-filter">Filter volunteer records</label>
        <input
          id="record-filter"
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.currentTarget.value)}
          placeholder="Name, email, or status"
        />
      </div>
      <p aria-live="polite">
        Showing {visible.length} of {people.length} records.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Primary email</th>
              <th>Last verified</th>
              <th>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((person) => (
              <tr key={person.id}>
                <td>
                  {person.displayName}
                  {!person.hasApprovedProfile && (
                    <span className="field-help">No approved profile</span>
                  )}
                </td>
                <td>{person.status.replaceAll("_", " ")}</td>
                <td>
                  {person.primaryEmail ?? "—"}
                  {person.deliverability && (
                    <span className="field-help">
                      {person.deliverability.replaceAll("_", " ").toLowerCase()}
                    </span>
                  )}
                </td>
                <td>{formatDateTime(person.lastVerifiedAt)}</td>
                <td>
                  <Link
                    className="button secondary"
                    to={`/staff/profiles/${person.id}`}
                  >
                    Manage
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface LifecycleException {
  person_id: string;
  display_name: string;
  status: string;
  last_verified_at: string | null;
  scheduled_purge_at: string | null;
  verified_addresses: number;
  deliverable_addresses: number;
}

export function LifecyclePage() {
  const { me, error: authError } = useStaff();
  const [exceptions, setExceptions] = useState<LifecycleException[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!me?.permissions.includes("lifecycle:read")) return;
    void api<{ exceptions: LifecycleException[] }>(
      "/api/staff/lifecycle/exceptions",
    )
      .then((response) => setExceptions(response.exceptions))
      .catch((caught: unknown) =>
        setError(
          caught instanceof Error
            ? caught.message
            : "Lifecycle exceptions could not be loaded.",
        ),
      );
  }, [me]);

  if (authError) return <AccessDenied message={authError} />;
  if (!me) return <Loading message="Checking staff access…" />;
  if (!me.permissions.includes("lifecycle:read"))
    return (
      <AccessDenied message="This role cannot view lifecycle exceptions." />
    );
  return (
    <div>
      <StaffNavigation me={me} />
      <p className="eyebrow">Administrator controls</p>
      <h1>Lifecycle exceptions</h1>
      <p>
        These records have no verified, deliverable email address. Automated
        reminders cannot reach them, so an administrator should review the
        record or contact information.
      </p>
      {error && (
        <Notice tone="warning">
          <p>{error}</p>
        </Notice>
      )}
      {!error && exceptions.length === 0 && (
        <Notice tone="success">
          <p>No lifecycle delivery exceptions need attention.</p>
        </Notice>
      )}
      {exceptions.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Verified addresses</th>
                <th>Last verified</th>
                <th>Scheduled purge</th>
                <th>
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {exceptions.map((exception) => (
                <tr key={exception.person_id}>
                  <td>{exception.display_name}</td>
                  <td>{exception.status.replaceAll("_", " ")}</td>
                  <td>{exception.verified_addresses}</td>
                  <td>{formatDateTime(exception.last_verified_at)}</td>
                  <td>{formatDateTime(exception.scheduled_purge_at)}</td>
                  <td>
                    <Link
                      className="button secondary"
                      to={`/staff/profiles/${exception.person_id}`}
                    >
                      Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AuditPage() {
  const { me, error: authError } = useStaff();
  const [events, setEvents] = useState<
    {
      id: string;
      occurred_at: string;
      action: string;
      actor_id: string;
      succeeded: boolean;
    }[]
  >([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!me?.permissions.includes("audit:read")) return;
    api<{
      events: {
        id: string;
        occurred_at: string;
        action: string;
        actor_id: string;
        succeeded: boolean;
      }[];
    }>("/api/staff/audit")
      .then((response) => setEvents(response.events))
      .catch((caught: unknown) =>
        setError(
          caught instanceof Error
            ? caught.message
            : "Audit events could not be loaded.",
        ),
      );
  }, [me]);
  if (authError) return <AccessDenied message={authError} />;
  if (!me) return <Loading />;
  if (!me.permissions.includes("audit:read"))
    return <AccessDenied message="This role cannot view audit events." />;
  return (
    <div>
      <StaffNavigation me={me} />
      <p className="eyebrow">Accountability controls</p>
      <h1>Privacy and lifecycle audit</h1>
      <p>
        Profile prose and contact details are intentionally absent. Raw staff
        query text is separately protected and expires after 90 days.
      </p>
      {error && (
        <Notice tone="warning">
          <p>{error}</p>
        </Notice>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>{formatDateTime(event.occurred_at)}</td>
                <td>{event.action}</td>
                <td>{event.actor_id}</td>
                <td>{event.succeeded ? "Succeeded" : "Failed"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function HealthPage() {
  const { me, error: authError } = useStaff();
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!me?.permissions.includes("technical:read")) return;
    api<Record<string, unknown>>("/api/technical/health")
      .then(setHealth)
      .catch((caught: unknown) =>
        setError(
          caught instanceof Error
            ? caught.message
            : "Health could not be loaded.",
        ),
      );
  }, [me]);
  if (authError) return <AccessDenied message={authError} />;
  if (!me) return <Loading />;
  if (!me.permissions.includes("technical:read"))
    return <AccessDenied message="This role cannot view operational health." />;
  return (
    <div>
      <StaffNavigation me={me} />
      <div className="narrow">
        <p className="eyebrow">Operational controls</p>
        <h1>Technical health</h1>
        <p>
          This view contains deployment and non-PII status only. Technical
          administrators cannot search or view profiles.
        </p>
        {error && (
          <Notice tone="warning">
            <p>{error}</p>
          </Notice>
        )}
        {health && (
          <dl className="health-list">
            {Object.entries(health).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}

interface AccessUser {
  subject: string;
  email: string;
  enabled: boolean;
  status: string;
  groups: StaffGroup[];
}

const manageableGroups = [
  "gis-staff",
  "gis-ministry-leader",
  "gis-privacy-auditor",
] as const;

export function StaffAccessPage() {
  const { me, error: authError } = useStaff();
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [notice, setNotice] = useState("");
  const [busyAction, setBusyAction] = useState("");

  async function refresh(): Promise<void> {
    const response = await api<{ users: AccessUser[] }>("/api/staff/access");
    setUsers(response.users);
  }
  useEffect(() => {
    if (!me?.permissions.includes("access:manage-lower")) return;
    void api<{ users: AccessUser[] }>("/api/staff/access")
      .then((response) => setUsers(response.users))
      .catch((caught: unknown) =>
        setNotice(
          caught instanceof Error
            ? caught.message
            : "Access list could not be loaded.",
        ),
      );
  }, [me]);
  if (authError) return <AccessDenied message={authError} />;
  if (!me) return <Loading />;
  if (!me.permissions.includes("access:manage-lower"))
    return <AccessDenied message="This role cannot manage staff access." />;
  async function invite(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const groups = manageableGroups.filter(
      (group) => data.get(`invite-${group}`) === "on",
    );
    if (!groups.length) {
      setNotice("Choose at least one lower-privilege role for the new user.");
      return;
    }
    setBusyAction("invite");
    try {
      await api("/api/staff/access/invite", {
        method: "POST",
        csrf: "staff",
        body: JSON.stringify({ email: data.get("email"), groups }),
      });
      form.reset();
      setNotice("Invitation sent with the selected lower-privilege access.");
      await refresh();
    } catch (caught) {
      setNotice(
        caught instanceof Error ? caught.message : "Invitation failed.",
      );
    } finally {
      setBusyAction("");
    }
  }

  async function updateGroups(
    event: FormEvent<HTMLFormElement>,
    subject: string,
  ): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const groups = manageableGroups.filter((group) => data.get(group) === "on");
    setBusyAction(`${subject}:groups`);
    try {
      await api(`/api/staff/access/${subject}/groups`, {
        method: "POST",
        csrf: "staff",
        body: JSON.stringify({ groups }),
      });
      setNotice("Lower-privilege roles updated.");
      await refresh();
    } catch (caught) {
      setNotice(
        caught instanceof Error ? caught.message : "Role update failed.",
      );
    } finally {
      setBusyAction("");
    }
  }

  async function staffAction(
    user: AccessUser,
    action: "delete" | "disable" | "enable" | "revoke-sessions",
  ): Promise<void> {
    const actionLabel =
      action === "delete"
        ? "permanently delete"
        : action === "disable"
          ? "disable"
          : action === "revoke-sessions"
            ? "sign out on every device"
            : "";
    if (
      actionLabel &&
      !window.confirm(
        `Are you sure you want to ${actionLabel} ${user.email || "this staff user"}?`,
      )
    )
      return;
    setBusyAction(`${user.subject}:${action}`);
    try {
      await api(
        action === "delete"
          ? `/api/staff/access/${user.subject}`
          : `/api/staff/access/${user.subject}/${action}`,
        {
          method: action === "delete" ? "DELETE" : "POST",
          csrf: "staff",
          ...(action === "delete" ? {} : { body: "{}" }),
        },
      );
      setNotice(
        action === "delete"
          ? "Staff user permanently deleted."
          : action === "disable"
            ? "Staff user disabled and signed out."
            : action === "enable"
              ? "Staff user enabled."
              : "Application and Cognito sessions revoked.",
      );
      await refresh();
    } catch (caught) {
      setNotice(
        caught instanceof Error ? caught.message : "Staff action failed.",
      );
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div>
      <StaffNavigation me={me} />
      <p className="eyebrow">Cognito access administration</p>
      <h1>Staff access</h1>
      <p>
        Invite, assign roles, disable, re-enable, sign out, or delete
        lower-privilege staff accounts. Administrator and
        technical-administrator access requires the documented AWS-authorized
        process and cannot be changed here.
      </p>
      {notice && (
        <Notice>
          <p>{notice}</p>
        </Notice>
      )}
      <form className="search-form" onSubmit={(event) => void invite(event)}>
        <label htmlFor="invite-email">Invite a native staff user</label>
        <input
          id="invite-email"
          name="email"
          type="email"
          required
          autoComplete="email"
        />
        <fieldset className="role-fieldset">
          <legend>Initial access</legend>
          {manageableGroups.map((group) => (
            <label className="check" key={group}>
              <input
                type="checkbox"
                name={`invite-${group}`}
                defaultChecked={group === "gis-staff"}
              />
              {groupLabels[group]}
            </label>
          ))}
        </fieldset>
        <button
          className="button primary"
          type="submit"
          disabled={busyAction === "invite"}
        >
          {busyAction === "invite"
            ? "Sending invitation…"
            : "Send Cognito invitation"}
        </button>
      </form>
      <div className="result-grid">
        {users.map((user) => {
          const protectedUser = user.groups.some((group) =>
            ["gis-admin", "gis-technical-admin"].includes(group),
          );
          const isSelf = user.subject === me.subject;
          return (
            <article className="result-card staff-user-card" key={user.subject}>
              <h2>{user.email || "Federated staff user"}</h2>
              <p>
                <span className="status">
                  {user.enabled ? user.status.replaceAll("_", " ") : "Disabled"}
                </span>
                {isSelf && " This is your account."}
              </p>
              <p>
                Roles:{" "}
                {user.groups.length
                  ? user.groups.map((group) => groupLabels[group]).join(", ")
                  : "None"}
              </p>
              {protectedUser ? (
                <Notice>
                  <p>
                    High-privilege access is read-only here and must be managed
                    through the AWS-authorized process.
                  </p>
                </Notice>
              ) : (
                <>
                  <form
                    onSubmit={(event) => void updateGroups(event, user.subject)}
                  >
                    <fieldset className="role-fieldset">
                      <legend>Lower-privilege roles</legend>
                      {manageableGroups.map((group) => (
                        <label className="check" key={group}>
                          <input
                            type="checkbox"
                            name={group}
                            defaultChecked={user.groups.includes(group)}
                            disabled={busyAction !== ""}
                          />
                          {groupLabels[group]}
                        </label>
                      ))}
                    </fieldset>
                    <button
                      className="button secondary"
                      type="submit"
                      disabled={busyAction !== ""}
                    >
                      Update roles
                    </button>
                  </form>
                  <div className="button-row">
                    <button
                      className="button secondary"
                      onClick={() => void staffAction(user, "revoke-sessions")}
                      type="button"
                      disabled={busyAction !== "" || isSelf}
                    >
                      Sign out everywhere
                    </button>
                    <button
                      className={
                        user.enabled ? "button danger" : "button primary"
                      }
                      onClick={() =>
                        void staffAction(
                          user,
                          user.enabled ? "disable" : "enable",
                        )
                      }
                      type="button"
                      disabled={busyAction !== "" || isSelf}
                    >
                      {user.enabled ? "Disable user" : "Enable user"}
                    </button>
                    <button
                      className="button danger"
                      onClick={() => void staffAction(user, "delete")}
                      type="button"
                      disabled={busyAction !== "" || isSelf}
                    >
                      Permanently delete user
                    </button>
                  </div>
                </>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function AccessDenied({
  message = "Your account does not have access to this page.",
}: {
  message?: string;
}) {
  return (
    <div className="narrow">
      <h1>Access denied</h1>
      <Notice tone="warning">
        <p>{message}</p>
      </Notice>
      <Link to="/staff">Return to staff sign in</Link>
    </div>
  );
}
