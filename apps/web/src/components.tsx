import { Component, Suspense, type ReactNode } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useConfig } from "./context.js";

export function RootLayout() {
  const config = useConfig();
  return (
    <>
      <header className="site-header">
        <div className="shell header-row">
          <Link className="brand" to="/" aria-label={`${config.appName} home`}>
            <img
              src="/gifts-in-service-logo.svg"
              alt=""
              width="1435"
              height="527"
            />
          </Link>
          <nav aria-label="Primary">
            <NavLink to="/privacy">Privacy</NavLink>
            <NavLink to="/ai-use">How AI is used</NavLink>
            <NavLink to="/staff">Staff</NavLink>
          </nav>
        </div>
      </header>
      <main id="main" className="shell main-content" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="shell footer-row">
          <div className="footer-brand">
            <span className="footer-mark" aria-hidden="true">
              ♡
            </span>
            <div>
              <p className="footer-name">{config.appName}</p>
              <p>{config.churchName}</p>
            </div>
          </div>
          <div className="footer-details">
            <p>Policy text is a draft requiring church and legal review.</p>
            <p>
              <a href={`mailto:${config.helpContactEmail}`}>Get help</a>
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}

export function Loading({
  message = "Starting Gifts in Service…",
}: {
  message?: string;
}) {
  return (
    <div className="status-card" role="status">
      <span className="spinner" aria-hidden="true" />
      {message}
    </div>
  );
}

export function PageSuspense({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}

export function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warning" | "success";
}) {
  return (
    <div
      className={`notice notice-${tone}`}
      role={tone === "warning" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

interface ErrorBoundaryState {
  error: string;
}

export class ErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { error: "" };
  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      error: error instanceof Error ? error.message : "Something went wrong.",
    };
  }
  override componentDidCatch(): void {}
  override render() {
    if (this.state.error)
      return (
        <main className="shell main-content">
          <h1>We could not load this page</h1>
          <p>{this.state.error}</p>
          <p>
            <Link to="/">Return home</Link>
          </p>
        </main>
      );
    return this.props.children;
  }
}
