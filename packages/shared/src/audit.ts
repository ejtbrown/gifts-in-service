const FORBIDDEN_LOG_KEYS = new Set([
  "email",
  "displayName",
  "approvedText",
  "profileText",
  "query",
  "token",
  "authorization",
  "cookie",
  "messages",
  "requestBody",
  "responseBody",
  "ip",
]);

export interface SanitizedLog {
  correlationId: string;
  route: string;
  status: number;
  durationMs: number;
  errorClass?: string;
}

export function sanitizedLog(
  input: SanitizedLog & Record<string, unknown>,
): SanitizedLog {
  const output: SanitizedLog = {
    correlationId: input.correlationId,
    route: input.route.split("?")[0] ?? input.route,
    status: input.status,
    durationMs: input.durationMs,
  };
  if (input.errorClass !== undefined) output.errorClass = input.errorClass;
  return output;
}

export function containsForbiddenLogField(
  input: Record<string, unknown>,
): boolean {
  return Object.keys(input).some((key) => FORBIDDEN_LOG_KEYS.has(key));
}
