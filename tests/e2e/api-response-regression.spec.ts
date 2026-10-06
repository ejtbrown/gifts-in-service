import { expect, test } from "@playwright/test";

const unexpectedResponse =
  "The service returned an unexpected response. Reload the page and try again.";

test("a successful HTML response cannot masquerade as a sent magic link", async ({
  page,
}) => {
  await page.route("**/api/public/magic-links", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Incorrect edge fallback</title>",
    });
  });

  await page.goto("/");
  await page
    .getByLabel("Email address")
    .fill("edge-regression@example.invalid");
  await page.getByRole("button", { name: "Email me a secure link" }).click();

  await expect(page.getByRole("alert")).toHaveText(unexpectedResponse);
  await expect(page).toHaveURL(/\/$/u);
  await expect(
    page.getByRole("button", { name: "Email me a secure link" }),
  ).toBeEnabled();
});

test("a successful HTML response cannot leave staff login in a false challenge state", async ({
  page,
}) => {
  await page.route("**/api/config", async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: { ...config, staffAuthMode: "cognito" },
    });
  });
  await page.route("**/api/staff/auth/login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Incorrect edge fallback</title>",
    });
  });

  await page.goto("/staff");
  await page
    .getByLabel("Staff email address")
    .fill("staff-edge-regression@example.invalid");
  await page.getByLabel("Password").fill("Fictional-Password-17!");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("alert")).toHaveText(unexpectedResponse);
  await expect(
    page.getByRole("heading", { name: "Staff sign in" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: /authenticator|permanent password/iu }),
  ).toHaveCount(0);
});
