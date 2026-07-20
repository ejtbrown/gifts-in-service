import { expect, test, type Page } from "@playwright/test";

const subject = "30000000-0000-4000-8000-000000000010";

async function mockStaff(
  page: Page,
  groups: string[],
  permissions: string[],
): Promise<void> {
  await page.route("**/api/staff/me", async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        subject,
        groups,
        permissions,
        csrfToken: "fictional-console-csrf",
      },
    });
  });
}

test("administrator sees volunteer, lifecycle, audit, and access controls but not technical controls", async ({
  page,
}) => {
  await mockStaff(
    page,
    ["gis-admin"],
    [
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
    ],
  );
  await page.route("**/api/staff/profiles", async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        people: [
          {
            id: "10000000-0000-4000-8000-000000000011",
            displayName: "Robin Example",
            status: "PAUSED",
            hasApprovedProfile: true,
            contentUpdatedAt: "2026-07-18T12:00:00.000Z",
            lastVerifiedAt: "2026-07-18T12:00:00.000Z",
            scheduledPurgeAt: null,
            primaryEmail: "robin@example.invalid",
            deliverability: "DELIVERABLE",
          },
        ],
      },
    });
  });

  await page.goto("/staff/profiles");
  await expect(
    page.getByRole("heading", { name: "Volunteer records" }),
  ).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Staff console" });
  await expect(navigation.getByRole("link", { name: "Search" })).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Volunteer records" }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Lifecycle exceptions" }),
  ).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Audit" })).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Staff access" }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Technical health" }),
  ).toHaveCount(0);
  await expect(page.getByText("Robin Example")).toBeVisible();
  await expect(page.getByRole("link", { name: "Manage" })).toBeVisible();
});

test("search-only staff see the query control and no administrative navigation", async ({
  page,
}) => {
  await mockStaff(
    page,
    ["gis-staff"],
    ["profile:search", "profile:read", "contact:read"],
  );
  const evidence =
    "They play bass guitar, noting that while they are not very good, they are learning every day.";
  const approvedText = `Morgan Example maintains computers and audio equipment. ${evidence}`;
  await page.route("**/api/staff/search", async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        results: [
          {
            personId: "10000000-0000-4000-8000-000000000012",
            approvedText,
            relevance: "MEDIUM",
            reason:
              "The approved profile contains direct evidence related to “bass player”. The relevant evidence also states a limitation or developing skill, which lowers the match grade.",
            evidence: [evidence],
            cautions: [
              "Confirm current proficiency and suitability before contact.",
            ],
            explanationGeneratedByAi: false,
          },
        ],
        suggestionNotice:
          "Suggestions are based on self-reported profiles. Verify requirements separately.",
      },
    });
  });
  await page.goto("/staff/search");
  const query = page.getByLabel(
    "What kind of experience or help are you looking for?",
  );
  await expect(query).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Staff console" });
  await expect(navigation.getByRole("link")).toHaveCount(1);
  await expect(navigation.getByRole("link", { name: "Search" })).toBeVisible();
  await query.fill("We need a bass player for the worship group");
  await page.getByRole("button", { name: "Search approved profiles" }).click();
  const result = page.getByRole("article");
  await expect(result.getByText("MEDIUM", { exact: true })).toBeVisible();
  await expect(
    result.getByText("Deterministic explanation", { exact: true }),
  ).toBeVisible();
  await expect(result.getByText(evidence, { exact: true })).toBeVisible();
  await expect(result.getByText(approvedText, { exact: true })).toBeHidden();
  await result
    .locator("summary", { hasText: "Show full approved profile" })
    .click();
  await expect(result.getByText(approvedText, { exact: true })).toBeVisible();
});

test("unauthorized roles never see the volunteer query prompt", async ({
  page,
}) => {
  await mockStaff(page, ["gis-privacy-auditor"], ["audit:read"]);
  await page.goto("/staff/search");
  await expect(
    page.getByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("What kind of experience or help are you looking for?"),
  ).toHaveCount(0);
});

test("privacy auditors and technical administrators see only their own consoles", async ({
  page,
}) => {
  await mockStaff(page, ["gis-privacy-auditor"], ["audit:read"]);
  await page.route("**/api/staff/audit", async (route) => {
    await route.fulfill({ status: 200, json: { events: [] } });
  });
  await page.goto("/staff/audit");
  let navigation = page.getByRole("navigation", { name: "Staff console" });
  await expect(navigation.getByRole("link")).toHaveCount(1);
  await expect(navigation.getByRole("link", { name: "Audit" })).toBeVisible();

  await page.unroute("**/api/staff/me");
  await mockStaff(page, ["gis-technical-admin"], ["technical:read"]);
  await page.route("**/api/technical/health", async (route) => {
    await route.fulfill({
      status: 200,
      json: { status: "ok", database: "reachable" },
    });
  });
  await page.goto("/staff/health");
  navigation = page.getByRole("navigation", { name: "Staff console" });
  await expect(navigation.getByRole("link")).toHaveCount(1);
  await expect(
    navigation.getByRole("link", { name: "Technical health" }),
  ).toBeVisible();
});

test("staff access exposes full lower-privilege lifecycle controls and protects administrators", async ({
  page,
}) => {
  await mockStaff(
    page,
    ["gis-admin"],
    ["access:manage-lower", "session:revoke"],
  );
  await page.route("**/api/staff/access", async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        users: [
          {
            subject,
            email: "admin@example.invalid",
            enabled: true,
            status: "CONFIRMED",
            groups: ["gis-admin"],
          },
          {
            subject: "30000000-0000-4000-8000-000000000011",
            email: "staff@example.invalid",
            enabled: true,
            status: "CONFIRMED",
            groups: ["gis-staff"],
          },
        ],
      },
    });
  });
  await page.goto("/staff/access");
  const adminCard = page
    .getByRole("article")
    .filter({ hasText: "admin@example.invalid" });
  await expect(
    adminCard.getByText(/High-privilege access is read-only/u),
  ).toBeVisible();
  await expect(
    adminCard.getByRole("button", { name: "Permanently delete user" }),
  ).toHaveCount(0);

  const staffCard = page
    .getByRole("article")
    .filter({ hasText: "staff@example.invalid" });
  await expect(
    staffCard.getByRole("button", { name: "Update roles" }),
  ).toBeVisible();
  await expect(
    staffCard.getByRole("button", { name: "Sign out everywhere" }),
  ).toBeVisible();
  await expect(
    staffCard.getByRole("button", { name: "Disable user" }),
  ).toBeVisible();
  await expect(
    staffCard.getByRole("button", { name: "Permanently delete user" }),
  ).toBeVisible();
});
