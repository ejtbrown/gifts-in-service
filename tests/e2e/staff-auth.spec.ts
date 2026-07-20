import { expect, test } from "@playwright/test";

test("Cognito password, permanent-password, and TOTP setup stay in the application", async ({
  page,
}) => {
  const cognitoHostRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname.endsWith("amazoncognito.com"))
      cognitoHostRequests.push(request.url());
  });

  await page.route("**/api/config", async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: { ...config, staffAuthMode: "cognito" },
    });
  });

  await page.route("**/api/staff/auth/login", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({
      email: "staff-browser@example.invalid",
      password: "Fictional-Temporary-17!",
    });
    await route.fulfill({
      status: 200,
      json: {
        authenticated: false,
        challenge: "NEW_PASSWORD_REQUIRED",
        transaction: "encrypted-new-password-transaction",
      },
    });
  });

  let challengeCount = 0;
  await page.route("**/api/staff/auth/challenge", async (route) => {
    challengeCount += 1;
    const body = route.request().postDataJSON() as {
      transaction: string;
      response: string;
    };
    if (challengeCount === 1) {
      expect(body).toEqual({
        transaction: "encrypted-new-password-transaction",
        response: "Fictional-Permanent-17!",
      });
      await route.fulfill({
        status: 200,
        json: {
          authenticated: false,
          challenge: "MFA_SETUP",
          transaction: "encrypted-totp-setup-transaction",
          secretCode: "JBSWY3DPEHPK3PXP",
        },
      });
      return;
    }
    expect(body).toEqual({
      transaction: "encrypted-totp-setup-transaction",
      response: "123456",
    });
    await route.fulfill({
      status: 200,
      json: {
        authenticated: true,
        groups: ["gis-staff"],
        permissions: ["profile:search", "profile:read", "contact:read"],
        csrfToken: "fictional-staff-csrf",
      },
    });
  });

  await page.route("**/api/staff/me", async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        subject: "30000000-0000-4000-8000-000000000002",
        groups: ["gis-staff"],
        permissions: ["profile:search", "profile:read", "contact:read"],
        csrfToken: "fictional-rotated-staff-csrf",
      },
    });
  });

  await page.goto("/staff");
  await expect(
    page.getByRole("heading", { name: "Staff sign in" }),
  ).toBeVisible();
  await expect(page.getByLabel("Staff email address")).toBeVisible();
  await expect(page.getByRole("link", { name: /Cognito/u })).toHaveCount(0);

  await page
    .getByLabel("Staff email address")
    .fill("staff-browser@example.invalid");
  await page.getByLabel("Password").fill("Fictional-Temporary-17!");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/staff$/u);
  await expect(
    page.getByRole("heading", { name: "Choose a permanent password" }),
  ).toBeVisible();
  await page
    .getByLabel("New password", { exact: true })
    .fill("Fictional-Permanent-17!");
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("Fictional-Permanent-17!");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/staff$/u);
  await expect(
    page.getByRole("heading", { name: "Set up your authenticator" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "QR code for authenticator setup" }),
  ).toBeVisible();
  await expect(page.getByText("JBSWY3DPEHPK3PXP")).toBeVisible();
  const code = page.getByLabel("Six-digit code");
  await expect(code).toBeFocused();
  await code.fill("12345");
  expect(challengeCount).toBe(1);
  await code.press("6");

  await expect(page).toHaveURL(/\/staff\/search$/u);
  await expect(
    page.getByRole("heading", { name: "Who might be able to help?" }),
  ).toBeVisible();
  expect(challengeCount).toBe(2);
  expect(cognitoHostRequests).toEqual([]);
});
