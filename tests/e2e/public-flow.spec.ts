import { expect, test, type APIRequestContext } from "@playwright/test";
import { SENSITIVE_INFORMATION_REJECTION_MESSAGE } from "../../packages/ai/src/index.js";

const PROFILE_SAVED_NOTICE =
  "Your profile has been saved. No further action is necessary unless you want to make changes.";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

async function waitForMagicLink(
  request: APIRequestContext,
  email: string,
  excludedMessageIds: ReadonlySet<string> = new Set(),
): Promise<string> {
  let magicLink = "";
  await expect
    .poll(async () => {
      const listing = record(
        (await (
          await request.get("http://127.0.0.1:8025/api/v1/messages")
        ).json()) as unknown,
      );
      const messages = Array.isArray(listing?.messages) ? listing.messages : [];
      for (const candidate of messages) {
        const message = record(candidate);
        const recipients = Array.isArray(message?.To) ? message.To : [];
        if (
          !recipients.some(
            (recipient) => record(recipient)?.Address === email,
          ) ||
          typeof message?.ID !== "string" ||
          excludedMessageIds.has(message.ID)
        )
          continue;
        const detail = record(
          (await (
            await request.get(
              `http://127.0.0.1:8025/api/v1/message/${message.ID}`,
            )
          ).json()) as unknown,
        );
        const found =
          typeof detail?.Text === "string"
            ? /http:\/\/127\.0\.0\.1:5173\/magic#token=[^\s]+/u.exec(
                detail.Text,
              )?.[0]
            : undefined;
        if (found) {
          magicLink = found;
          break;
        }
      }
      return magicLink;
    })
    .not.toBe("");
  return magicLink;
}

async function messageIdsFor(
  request: APIRequestContext,
  email: string,
): Promise<Set<string>> {
  const listing = record(
    (await (
      await request.get("http://127.0.0.1:8025/api/v1/messages")
    ).json()) as unknown,
  );
  const messages = Array.isArray(listing?.messages) ? listing.messages : [];
  return new Set(
    messages.flatMap((candidate) => {
      const message = record(candidate);
      const recipients = Array.isArray(message?.To) ? message.To : [];
      return typeof message?.ID === "string" &&
        recipients.some((recipient) => record(recipient)?.Address === email)
        ? [message.ID]
        : [];
    }),
  );
}

test("fictional member resumes a pending interview through a new link, approves it, reconfirms, and deletes it", async ({
  page,
  request,
}) => {
  const email = `complete-${Date.now()}@example.invalid`;
  await page.goto("/");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a secure link" }).click();

  const magicLink = await waitForMagicLink(request, email);

  await page.goto(magicLink);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
  await expect(
    page.getByRole("heading", { name: "Choose a profile" }),
  ).toBeVisible();
  const rawToken = new URL(magicLink).hash.slice("#token=".length);
  expect(
    await page.evaluate(
      async (token) =>
        (
          await fetch("/api/public/magic-links/redeem", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          })
        ).status,
      rawToken,
    ),
  ).toBe(410);
  await page.getByRole("button", { name: "Create New User" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByLabel("Your name")
    .fill("Complete Browser Fiction");
  await page.getByRole("dialog").getByRole("button", { name: "OK" }).click();
  await expect(
    page.getByRole("heading", { name: "Before you create your profile" }),
  ).toBeVisible();
  await page.getByLabel("I confirm that I am at least 18 years old.").check();
  await page.getByLabel(/I have read and acknowledge/u).check();
  await page.getByRole("button", { name: "Create Profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Tell us about your gifts" }),
  ).toBeVisible();
  const response = page.getByLabel("Your response");
  const rejectedSensitiveInput = "My fictional SSN is 000-00-0000.";
  await response.fill(rejectedSensitiveInput);
  await response.press("Enter");
  await expect(page.getByRole("alert")).toHaveText(
    SENSITIVE_INFORMATION_REJECTION_MESSAGE,
  );
  await expect(page.locator(".chat")).not.toContainText(rejectedSensitiveInput);
  await expect(response).toHaveValue(rejectedSensitiveInput);
  await expect(response).toBeFocused();
  const firstAnswer =
    "I maintain WordPress and React sites, improve accessibility, and can offer occasional advice but not on-call support.";
  await response.fill(firstAnswer);
  await response.press("Enter");
  await expect(response).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Create a draft" }),
  ).toBeEnabled();
  await expect(response).toBeFocused();
  await page.reload();
  await expect(page.getByText(firstAnswer, { exact: true })).toBeVisible();

  const existingMessageIds = await messageIdsFor(request, email);
  await page.context().clearCookies();
  await page.goto("/");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a secure link" }).click();
  await page.goto(await waitForMagicLink(request, email, existingMessageIds));
  await page
    .getByRole("button", { name: "Continue as Complete Browser Fiction" })
    .click();
  await expect(page.getByText(firstAnswer, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create a draft" }).click();
  const exactDraft = await page
    .getByLabel("Exact proposed profile")
    .innerText();
  expect(exactDraft).toContain("WordPress and React");
  await page.getByRole("button", { name: "Approve and Save" }).click();
  await expect(
    page.getByRole("heading", { name: "Complete Browser Fiction" }),
  ).toBeVisible();
  await expect(
    page.getByText(PROFILE_SAVED_NOTICE, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(exactDraft, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  await page.getByRole("button", { name: "Let Me Update This" }).click();
  await expect(
    page.getByRole("heading", { name: "Update your profile" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("article", { name: "Your current profile" })
      .getByText(exactDraft, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Your current profile is shown above. What has changed, what would you like to add, or what would you like removed?",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByLabel("Your response")
    .fill(
      "Add that I prefer one-time accessibility reviews and remove any implication of ongoing support.",
    );
  await page.getByRole("button", { name: "Send response" }).click();
  await page
    .getByLabel("Your response")
    .fill("Please prepare a proposed profile now.");
  await page.getByLabel("Your response").press("Enter");
  await expect(
    page.getByRole("button", { name: "Submit profile" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".chat-message.assistant")
      .last()
      .getByText(/prefer one-time accessibility reviews/u),
  ).toBeVisible();
  await page.getByRole("button", { name: "Submit profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Complete Browser Fiction" }),
  ).toBeVisible();
  await expect(
    page.getByText(PROFILE_SAVED_NOTICE, { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".profile-prose")
      .getByText(/prefer one-time accessibility reviews/u),
  ).toBeVisible();
  await page.getByRole("button", { name: "That Looks Right" }).click();
  await expect(page.getByText("Your profile was reconfirmed.")).toBeVisible();
  await page.getByRole("link", { name: "Permanently delete" }).click();
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Permanently delete" }).click();
  await expect(
    page.getByRole("heading", { name: "Share your gifts, in your own words" }),
  ).toBeVisible();
});

test("shared mailbox chooser keeps two fictional profiles distinct", async ({
  page,
  request,
}) => {
  const email = "shared.household@example.invalid";
  const existingMessageIds = await messageIdsFor(request, email);
  await page.goto("/");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a secure link" }).click();
  await page.goto(await waitForMagicLink(request, email, existingMessageIds));
  await expect(
    page.getByRole("button", { name: "Continue as Taylor Sample" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue as Jordan Fiction" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Anyone with access to this shared mailbox may be able to open the profiles associated with it.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue as Taylor Sample" }).click();
  await expect(
    page.getByRole("heading", { name: "Update your profile" }),
  ).toBeVisible();
});

test("landing disclosure is present before identity fields and request response stays neutral", async ({
  page,
}) => {
  await page.goto("/");
  const disclosure = page.getByRole("region", {
    name: "Privacy and AI information",
  });
  const sections = disclosure.locator("details");
  const summaries = disclosure.locator("summary");
  await expect(sections).toHaveCount(3);
  await expect(summaries).toHaveText([
    "How Gifts in Service uses your information",
    "How AI is used",
    "Full privacy statement",
  ]);
  await expect(disclosure.locator("details[open]")).toHaveCount(0);
  await expect(
    page.getByText(
      "Your approved Gifts in Service profile may be viewed by authorized church staff and designated ministry leaders for the purpose of identifying and contacting potential volunteers. Please do not include information you would not be comfortable sharing with those authorized users.",
      { exact: true },
    ),
  ).not.toBeVisible();
  await summaries.nth(0).focus();
  await summaries.nth(0).press("Enter");
  await expect(sections.nth(0)).toHaveAttribute("open", "");
  await summaries.nth(1).click();
  await expect(
    page.getByRole("link", {
      name: "Open the AI explanation as a separate page",
    }),
  ).toBeVisible();
  await summaries.nth(2).click();
  await expect(
    page.getByRole("link", {
      name: "Open the full privacy statement as a separate page",
    }),
  ).toBeVisible();
  await summaries.nth(0).press("Enter");
  await summaries.nth(1).click();
  await summaries.nth(2).click();
  await expect(disclosure.locator("details[open]")).toHaveCount(0);
  await expect(page.getByLabel("Your name")).toHaveCount(0);
  await expect(
    page.getByLabel("I confirm that I am at least 18 years old."),
  ).toHaveCount(0);
  const email = page.getByLabel("Email address");
  await expect(email).toBeInViewport();
  await email.fill(`browser-${Date.now()}@example.invalid`);
  await page.getByRole("button", { name: "Email me a secure link" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "If the address can receive a Gifts in Service link, an email has been sent.",
    ),
  ).toBeVisible();
});

test("magic page redeems automatically, removes its fragment, and refuses a missing token", async ({
  page,
}) => {
  await page.goto(
    "/magic#token=fake-private-token-that-is-long-enough-for-browser-only",
  );
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
  await expect(
    page.getByRole("heading", { name: "This link could not be opened" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByText("The link did not contain a token. Request a new link."),
  ).toBeVisible();
});

test("profile text is rendered as inert text", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const element = document.createElement("p");
    element.textContent = "<img src=x onerror=window.__xss=true>";
    element.id = "xss-fixture";
    document.body.append(element);
  });
  await expect(page.locator("#xss-fixture")).toHaveText(
    "<img src=x onerror=window.__xss=true>",
  );
  expect(
    await page.evaluate(() => (window as Window & { __xss?: boolean }).__xss),
  ).not.toBe(true);
});
