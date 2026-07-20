import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { ErrorBoundary, PageSuspense, RootLayout } from "./components.js";
import { ConfigProvider } from "./context.js";
import { AiUsePage, PrivacyPage } from "./policies.js";
import {
  CheckEmailPage,
  ChooseProfilePage,
  DeletePage,
  EmailManagementPage,
  InterviewPage,
  LandingPage,
  MagicPage,
  MemberPage,
  RecoveryPage,
  ReviewPage,
  VerifyEmailPage,
} from "./member.js";
import {
  AccessDenied,
  AuditPage,
  HealthPage,
  LifecyclePage,
  StaffAccessPage,
  StaffLandingPage,
  StaffProfilePage,
  StaffRecordsPage,
  StaffSearchPage,
} from "./staff.js";
import "./styles.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    errorElement: <RecoveryPage title="Page not found" />,
    children: [
      { index: true, element: <LandingPage /> },
      { path: "check-email", element: <CheckEmailPage /> },
      { path: "magic", element: <MagicPage /> },
      { path: "choose-profile", element: <ChooseProfilePage /> },
      { path: "verify-email", element: <VerifyEmailPage /> },
      { path: "member", element: <MemberPage /> },
      { path: "member/interview", element: <InterviewPage /> },
      { path: "member/review", element: <ReviewPage /> },
      { path: "member/emails", element: <EmailManagementPage /> },
      { path: "member/delete", element: <DeletePage /> },
      { path: "privacy", element: <PrivacyPage /> },
      { path: "ai-use", element: <AiUsePage /> },
      { path: "staff", element: <StaffLandingPage /> },
      { path: "staff/search", element: <StaffSearchPage /> },
      { path: "staff/profiles", element: <StaffRecordsPage /> },
      { path: "staff/profiles/:id", element: <StaffProfilePage /> },
      { path: "staff/lifecycle", element: <LifecyclePage /> },
      { path: "staff/audit", element: <AuditPage /> },
      { path: "staff/health", element: <HealthPage /> },
      { path: "staff/access", element: <StaffAccessPage /> },
      { path: "access-denied", element: <AccessDenied /> },
      {
        path: "expired",
        element: <RecoveryPage title="Link expired or already used" />,
      },
    ],
  },
]);

const root = document.querySelector("#root");
if (!root) throw new Error("Application root was not found");
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <ConfigProvider>
        <PageSuspense>
          <RouterProvider router={router} />
        </PageSuspense>
      </ConfigProvider>
    </ErrorBoundary>
  </StrictMode>,
);
