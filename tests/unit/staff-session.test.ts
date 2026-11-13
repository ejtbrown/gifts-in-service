import { afterEach, describe, expect, it, vi } from "vitest";

function response(csrfToken: string): Response {
  return new Response(JSON.stringify({ csrfToken }), {
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("staff session request lifecycle", () => {
  it("coalesces abandoned and active consumers and sets CSRF before resolution", async () => {
    let complete!: (value: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const { getStaffSession, api } = await import("../../apps/web/src/api.js");
    const abandoned = getStaffSession();
    const active = getStaffSession();
    expect(active).toBe(abandoned);
    expect(fetch).toHaveBeenCalledTimes(1);
    complete(response("synthetic-current"));
    await active;
    fetch.mockResolvedValueOnce(response("unused"));
    await api("/api/staff/auth/logout", {
      method: "POST",
      body: "{}",
      csrf: "staff",
    });
    const options = fetch.mock.calls[1]?.[1];
    expect(new Headers(options?.headers).get("X-CSRF-Token")).toBe(
      "synthetic-current",
    );
  });

  it("starts a fresh session read after a completed request", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response("first"))
      .mockResolvedValueOnce(response("second"));
    vi.stubGlobal("fetch", fetch);
    const { getStaffSession } = await import("../../apps/web/src/api.js");
    expect((await getStaffSession()).csrfToken).toBe("first");
    expect((await getStaffSession()).csrfToken).toBe("second");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("releases a failed request so remount can retry", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("synthetic failure"))
      .mockResolvedValueOnce(response("retry"));
    vi.stubGlobal("fetch", fetch);
    const { getStaffSession } = await import("../../apps/web/src/api.js");
    await expect(getStaffSession()).rejects.toThrow("synthetic failure");
    expect((await getStaffSession()).csrfToken).toBe("retry");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["synthetic-login-B", ""])(
    "preserves explicit auth token %j when an old read rejects",
    async (authToken) => {
      const pending: ((response: Response) => void)[] = [];
      const fetch = vi.fn<typeof globalThis.fetch>(
        () => new Promise<Response>((resolve) => pending.push(resolve)),
      );
      vi.stubGlobal("fetch", fetch);
      const { getStaffSession, setStaffCsrf, api } =
        await import("../../apps/web/src/api.js");
      const old = getStaffSession();
      const rejected = expect(old).rejects.toThrow("Staff session changed");
      setStaffCsrf(authToken);
      const current = getStaffSession();
      expect(current).not.toBe(old);
      pending[0]!(response("synthetic-old-A"));
      await rejected;
      fetch.mockResolvedValueOnce(response("synthetic-write"));
      await api("/api/staff/auth/logout", {
        method: "POST",
        body: "{}",
        csrf: "staff",
      });
      expect(
        new Headers(fetch.mock.calls[2]?.[1]?.headers).get("X-CSRF-Token"),
      ).toBe(authToken);
      expect(getStaffSession()).toBe(current);
      pending[1]!(response("synthetic-current-B"));
      expect((await current).csrfToken).toBe("synthetic-current-B");
      expect(fetch).toHaveBeenCalledTimes(3);
    },
  );
});
