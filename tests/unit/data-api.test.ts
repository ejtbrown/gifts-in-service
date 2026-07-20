import { describe, expect, it, vi } from "vitest";
import {
  DataApiExecutor,
  type SqlExecutor,
} from "../../packages/db/src/executor.js";
import { Repository } from "../../packages/db/src/repository.js";

describe("RDS Data API decoding", () => {
  it("normalizes timestamps and PostgreSQL arrays for production repositories", async () => {
    const send = vi.fn().mockResolvedValue({
      columnMetadata: [
        { name: "last_verified_at", typeName: "timestamptz" },
        { name: "effective_groups", typeName: "_text" },
      ],
      records: [
        [
          { stringValue: "2026-07-15T12:00:00.000Z" },
          {
            arrayValue: { stringValues: ["gis-staff", "gis-technical-admin"] },
          },
        ],
      ],
      numberOfRecordsUpdated: 0,
    });
    const executor = new DataApiExecutor(
      {
        resourceArn: "arn:aws:rds:us-east-1:000000000000:cluster:fictional",
        secretArn:
          "arn:aws:secretsmanager:us-east-1:000000000000:secret:fictional",
        database: "gifts_in_service",
        region: "us-east-1",
      },
      { send } as never,
    );
    const result = await executor.query<{
      last_verified_at: Date;
      effective_groups: string[];
    }>("SELECT safe_fixture");
    expect(result.rows[0]?.last_verified_at).toBeInstanceOf(Date);
    expect(result.rows[0]?.last_verified_at.toISOString()).toBe(
      "2026-07-15T12:00:00.000Z",
    );
    expect(result.rows[0]?.effective_groups).toEqual([
      "gis-staff",
      "gis-technical-admin",
    ]);
    expect(result.rowCount).toBe(1);
  });

  it("encodes Date parameters in the format accepted by the Data API", async () => {
    let capturedCommand: unknown;
    const send = vi.fn((command: unknown) => {
      capturedCommand = command;
      return Promise.resolve({ records: [] });
    });
    const executor = new DataApiExecutor(
      {
        resourceArn: "arn:aws:rds:us-east-1:000000000000:cluster:fictional",
        secretArn:
          "arn:aws:secretsmanager:us-east-1:000000000000:secret:fictional",
        database: "gifts_in_service",
        region: "us-east-1",
      },
      { send } as never,
    );

    await executor.query("SELECT $1::timestamptz", [
      new Date("2026-07-16T16:00:00.123Z"),
    ]);

    expect(capturedCommand).toMatchObject({
      input: {
        parameters: [
          {
            name: "p1",
            value: { stringValue: "2026-07-16 16:00:00.123" },
            typeHint: "TIMESTAMP",
          },
        ],
      },
    });
  });

  it("keeps retrying while an auto-paused Aurora cluster resumes", async () => {
    vi.useFakeTimers();
    try {
      const resuming = Object.assign(new Error("resuming"), {
        name: "DatabaseResumingException",
      });
      const send = vi
        .fn()
        .mockRejectedValueOnce(resuming)
        .mockRejectedValueOnce(resuming)
        .mockRejectedValueOnce(resuming)
        .mockRejectedValueOnce(resuming)
        .mockResolvedValue({ records: [] });
      const executor = new DataApiExecutor(
        {
          resourceArn: "arn:aws:rds:us-east-1:000000000000:cluster:fictional",
          secretArn:
            "arn:aws:secretsmanager:us-east-1:000000000000:secret:fictional",
          database: "gifts_in_service",
          region: "us-east-1",
        },
        { send } as never,
      );

      const query = executor.query("SELECT 1");
      await vi.runAllTimersAsync();
      await expect(query).resolves.toMatchObject({ rows: [], rowCount: 0 });
      expect(send).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts transactions in the configured database", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ transactionId: "transaction-1" })
      .mockResolvedValueOnce({ records: [] })
      .mockResolvedValueOnce({});
    const executor = new DataApiExecutor(
      {
        resourceArn: "arn:aws:rds:us-east-1:000000000000:cluster:fictional",
        secretArn:
          "arn:aws:secretsmanager:us-east-1:000000000000:secret:fictional",
        database: "gifts_in_service",
        region: "us-east-1",
      },
      { send } as never,
    );

    await executor.transaction((transaction) => transaction.query("SELECT 1"));

    expect(send.mock.calls[0]?.[0]).toMatchObject({
      input: {
        resourceArn: "arn:aws:rds:us-east-1:000000000000:cluster:fictional",
        secretArn:
          "arn:aws:secretsmanager:us-east-1:000000000000:secret:fictional",
        database: "gifts_in_service",
      },
    });
    expect(send.mock.calls[1]?.[0]).toMatchObject({
      input: {
        database: "gifts_in_service",
        transactionId: "transaction-1",
      },
    });
  });

  it("casts an ID returned by one statement before using it as a UUID", async () => {
    const personId = "ceb71c05-eeac-447f-bde3-e4572cde32b5";
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: personId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const executor: SqlExecutor = {
      query,
      transaction: <T>(work: (transaction: SqlExecutor) => Promise<T>) =>
        work(executor),
    };

    await new Repository(executor).createPerson({
      displayName: "Data API Fiction",
      normalizedDisplayName: "data api fiction",
      displayEmail: "data-api@example.invalid",
      normalizedEmail: "data-api@example.invalid",
      consentVersion: "2026-07-15.v1",
      now: new Date("2026-07-16T20:30:00.000Z"),
    });

    expect(query.mock.calls[1]?.[0]).toContain("VALUES ($1::uuid");
  });
});
