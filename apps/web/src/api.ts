export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let memberCsrf = "";
let staffCsrf = "";
let staffSessionGeneration = 0;
let staffSessionRequest: Promise<unknown> | null = null;
let memberSessionRequest: Promise<unknown> | null = null;

export function setMemberCsrf(value: string): void {
  memberCsrf = value;
}

export function setStaffCsrf(value: string): void {
  staffCsrf = value;
  staffSessionGeneration += 1;
  staffSessionRequest = null;
}

export function getMemberSession<
  T extends { csrfToken: string },
>(): Promise<T> {
  if (!memberSessionRequest) {
    memberSessionRequest = api<T>("/api/member/session")
      .then((response) => {
        memberCsrf = response.csrfToken;
        return response;
      })
      .finally(() => {
        memberSessionRequest = null;
      });
  }
  return memberSessionRequest as Promise<T>;
}

export function getStaffSession<T extends { csrfToken: string }>(): Promise<T> {
  if (!staffSessionRequest) {
    const generation = staffSessionGeneration;
    const request = api<T>("/api/staff/me")
      .then((response) => {
        if (generation !== staffSessionGeneration)
          throw new Error("Staff session changed. Sign in again.");
        staffCsrf = response.csrfToken;
        return response;
      })
      .finally(() => {
        if (staffSessionRequest === request) staffSessionRequest = null;
      });
    staffSessionRequest = request;
  }
  return staffSessionRequest as Promise<T>;
}

export async function api<T>(
  path: string,
  options: RequestInit & { csrf?: "member" | "staff" } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined)
    headers.set("Content-Type", "application/json");
  if (options.csrf === "member") headers.set("X-CSRF-Token", memberCsrf);
  if (options.csrf === "staff") headers.set("X-CSRF-Token", staffCsrf);
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const isJson =
    contentType.includes("application/json") || contentType.includes("+json");
  let body: unknown = null;
  if (isJson) {
    try {
      body = (await response.json()) as unknown;
    } catch {
      body = null;
    }
  }
  const error =
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
      ? body.error
      : null;
  if (!response.ok)
    throw new ApiError(
      error ?? "The request could not be completed.",
      response.status,
    );
  if (body === null)
    throw new ApiError(
      "The service returned an unexpected response. Reload the page and try again.",
      502,
    );
  return body as T;
}
