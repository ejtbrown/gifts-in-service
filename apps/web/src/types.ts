import type { ProfileStatus, StaffGroup } from "@gis/shared";

export interface PublicConfiguration {
  appName: string;
  churchName: string;
  privacyContactEmail: string;
  helpContactEmail: string;
  disclosure: { version: string; title: string; paragraphs: readonly string[] };
  approvalDisclosure: { title: string; paragraphs: readonly string[] };
  staffAuthMode: "cognito" | "fake";
}

export interface Person {
  id: string;
  displayName: string;
  status: ProfileStatus;
  approvedText: string | null;
  contentUpdatedAt: string | null;
  lastVerifiedAt: string | null;
  scheduledPurgeAt: string | null;
}

export interface PersonEmail {
  id: string;
  displayEmail: string;
  verifiedAt: string | null;
  isPrimary: boolean;
  deliverability: string;
}

export interface MemberSessionResponse {
  person: Person | null;
  profiles: { id: string; displayName: string }[];
  emails: PersonEmail[];
  csrfToken: string;
}

export interface StaffMe {
  subject: string;
  groups: StaffGroup[];
  permissions: string[];
  csrfToken: string;
}
