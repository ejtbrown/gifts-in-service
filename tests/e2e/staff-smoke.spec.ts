import { expect, test } from "@playwright/test";

test("@smoke fictional staff signs in, searches, opens a profile, and signs out", async ({
  page,
}) => {
  await page.goto("/staff");
  await page.getByRole("button", { name: /gis-staff/u }).click();

  await expect(page).toHaveURL(/\/staff\/search$/u);
  await expect(
    page.getByRole("heading", { name: "Who might be able to help?" }),
  ).toBeVisible();
  await page
    .getByLabel("What kind of experience or help are you looking for?")
    .fill(
      "Who could help us understand intermittent problems with an older commercial air-conditioning unit?",
    );
  await page.getByRole("button", { name: "Search approved profiles" }).click();

  await expect(
    page.getByRole("heading", { name: /\d+ possible matches/u }),
  ).toBeVisible();
  const firstResult = page.getByRole("article").first();
  await expect(firstResult).toBeVisible();
  await firstResult
    .getByRole("link", { name: "View profile and contact details" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Exact approved profile" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Verified contact associations" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/staff$/u);
  await expect(
    page.getByRole("heading", { name: "Staff sign in" }),
  ).toBeVisible();
});
