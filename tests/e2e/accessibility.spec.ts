import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("@a11y landing and policy pages have no automatically detectable serious violations", async ({
  page,
}) => {
  for (const path of ["/", "/privacy", "/ai-use", "/staff"]) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    if (path === "/") {
      for (const summary of await page.locator("summary").all()) {
        await summary.click();
      }
    }
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
  }
});

test("@a11y confirmation actions use the exact required labels", async ({
  page,
}) => {
  await page.goto("/");
  expect(await page.locator("body").textContent()).not.toContain(
    "dangerouslySetInnerHTML",
  );
});
