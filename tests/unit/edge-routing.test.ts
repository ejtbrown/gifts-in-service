import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";

interface EdgeRequest {
  method: string;
  uri: string;
  headers: { host: { value: string } };
  querystring: Record<
    string,
    { value: string; multiValue?: { value: string }[] }
  >;
}

interface EdgeResponse {
  statusCode: number;
  headers: Record<string, { value: string }>;
  body?: string;
}

type EdgeResult = EdgeRequest | EdgeResponse;
type EdgeHandler = (event: { request: EdgeRequest }) => EdgeResult;

const repositoryRoot = resolve(import.meta.dirname, "../..");
let handler: EdgeHandler;

function request(
  host: string,
  uri: string,
  method = "GET",
  querystring: EdgeRequest["querystring"] = {},
): EdgeRequest {
  return { method, uri, headers: { host: { value: host } }, querystring };
}

beforeAll(async () => {
  const template = await readFile(
    resolve(
      repositoryRoot,
      "infra/modules/storage-edge/viewer-request.js.tftpl",
    ),
    "utf8",
  );
  const context: { handler?: EdgeHandler } = {};
  runInNewContext(
    template.replace(
      "${canonical_host_json}",
      JSON.stringify("gis.example.invalid"),
    ),
    context,
  );
  if (!context.handler) throw new Error("Edge handler was not defined");
  handler = context.handler;
});

describe("CloudFront viewer routing", () => {
  it("rewrites browser routes but never API routes to the SPA", () => {
    const browserRoute = request("gis.example.invalid", "/staff");
    expect(handler({ request: browserRoute })).toBe(browserRoute);
    expect(browserRoute.uri).toBe("/index.html");

    const apiRoute = request("gis.example.invalid", "/api/staff/me");
    expect(handler({ request: apiRoute })).toBe(apiRoute);
    expect(apiRoute.uri).toBe("/api/staff/me");

    const asset = request("gis.example.invalid", "/assets/app.js");
    handler({ request: asset });
    expect(asset.uri).toBe("/assets/app.js");
  });

  it("redirects legacy browser URLs to the canonical hostname", () => {
    const result = handler({
      request: request("legacy.cloudfront.net", "/staff", "GET", {
        section: { value: "people & profiles" },
      }),
    }) as EdgeResponse;

    expect(result.statusCode).toBe(308);
    expect(result.headers.location?.value).toBe(
      "https://gis.example.invalid/staff?section=people%20%26%20profiles",
    );
    expect(result.headers["cache-control"]?.value).toBe("no-store");
  });

  it("returns a JSON error to API calls from stale legacy pages", () => {
    const result = handler({
      request: request(
        "legacy.cloudfront.net",
        "/api/public/magic-links",
        "POST",
      ),
    }) as EdgeResponse;

    expect(result.statusCode).toBe(409);
    expect(result.headers["content-type"]?.value).toContain("application/json");
    expect(JSON.parse(result.body ?? "{}")).toEqual({
      error:
        "This site has moved. Reload the page at https://gis.example.invalid and try again.",
    });
  });
});
