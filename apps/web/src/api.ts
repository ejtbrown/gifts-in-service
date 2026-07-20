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
let memberSessionRequest: Promise<unknown> | null = null;

export function setMemberCsrf(value: string): void {
  memberCsrf = value;
}

export function setStaffCsrf(value: string): void {
  staffCsrf = value;
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
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok)
    throw new ApiError(
      body.error ?? "The request could not be completed.",
      response.status,
    );
  return body as T;
}
