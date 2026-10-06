import assert from "node:assert/strict";

const baseUrl = requiredUrl("SMOKE_BASE_URL");
const legacyUrl = optionalUrl("SMOKE_LEGACY_URL");

function requiredUrl(name: string): URL {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return normalizedUrl(value);
}

function optionalUrl(name: string): URL | null {
  const value = process.env[name];
  return value ? normalizedUrl(value) : null;
}

function normalizedUrl(value: string): URL {
  const url = new URL(value);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

async function get(path: string, redirect: RequestRedirect = "follow") {
  return fetch(new URL(path, baseUrl), {
    redirect,
    signal: AbortSignal.timeout(15_000),
    headers: { Accept: "application/json, text/html" },
  });
}

async function post(origin: URL, path: string, body: object) {
  return fetch(new URL(path, origin), {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: origin.origin,
    },
    body: JSON.stringify(body),
  });
}

function assertJson(response: Response): void {
  assert.match(
    response.headers.get("content-type") ?? "",
    /application\/json/iu,
  );
}

const root = await get("/");
assert.equal(root.status, 200);
assert.match(root.headers.get("content-type") ?? "", /text\/html/iu);
assert.match(await root.text(), /id=["']root["']/u);

const staffRoute = await get("/staff");
assert.equal(staffRoute.status, 200);
assert.match(staffRoute.headers.get("content-type") ?? "", /text\/html/iu);
assert.match(await staffRoute.text(), /id=["']root["']/u);

const config = await get("/api/config");
assert.equal(config.status, 200);
assertJson(config);
const configBody = (await config.json()) as Record<string, unknown>;
assert.equal(typeof configBody.appName, "string");
assert.ok(["cognito", "fake"].includes(String(configBody.staffAuthMode)));

const magicLink = await post(baseUrl, "/api/public/magic-links", {
  email: "success@simulator.amazonses.com",
});
assert.equal(magicLink.status, 202);
assertJson(magicLink);
assert.equal(
  typeof ((await magicLink.json()) as { message?: unknown }).message,
  "string",
);

const staffLogin = await post(baseUrl, "/api/staff/auth/login", {
  email: "deployment-smoke@example.invalid",
  password: "Fictional-Invalid-Password-17!",
});
assert.equal(staffLogin.status, 401);
assertJson(staffLogin);

const missingApi = await get("/api/public/deployment-smoke-not-found");
assert.equal(missingApi.status, 404);
assertJson(missingApi);

if (legacyUrl && legacyUrl.origin !== baseUrl.origin) {
  const legacyRoute = await fetch(new URL("/staff", legacyUrl), {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(legacyRoute.status, 308);
  assert.equal(
    legacyRoute.headers.get("location"),
    new URL("/staff", baseUrl).toString(),
  );

  const legacyApi = await post(legacyUrl, "/api/public/magic-links", {
    email: "legacy-smoke@example.invalid",
  });
  assert.equal(legacyApi.status, 409);
  assertJson(legacyApi);
}

process.stdout.write("Deployment smoke checks passed.\n");
