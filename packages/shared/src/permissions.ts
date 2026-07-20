import type { StaffGroup } from "./schemas.js";

export const permissions = [
  "profile:search",
  "profile:read",
  "contact:read",
  "profile:pause",
  "profile:reactivate",
  "profile:purge",
  "lifecycle:read",
  "audit:read",
  "access:manage-lower",
  "session:revoke",
  "reembed:run",
  "technical:read",
] as const;

export type Permission = (typeof permissions)[number];

export const GROUP_PERMISSIONS: Readonly<
  Record<StaffGroup, readonly Permission[]>
> = {
  "gis-admin": [
    "profile:search",
    "profile:read",
    "contact:read",
    "profile:pause",
    "profile:reactivate",
    "profile:purge",
    "lifecycle:read",
    "audit:read",
    "access:manage-lower",
    "session:revoke",
    "reembed:run",
  ],
  "gis-staff": ["profile:search", "profile:read", "contact:read"],
  "gis-ministry-leader": ["profile:search", "profile:read", "contact:read"],
  "gis-privacy-auditor": ["audit:read"],
  "gis-technical-admin": ["technical:read"],
};

export const MANAGEABLE_GROUPS: readonly StaffGroup[] = [
  "gis-staff",
  "gis-ministry-leader",
  "gis-privacy-auditor",
];

export function permissionsFor(
  groups: readonly StaffGroup[],
): ReadonlySet<Permission> {
  return new Set(groups.flatMap((group) => GROUP_PERMISSIONS[group]));
}

export function hasPermission(
  groups: readonly StaffGroup[],
  permission: Permission,
): boolean {
  return permissionsFor(groups).has(permission);
}
