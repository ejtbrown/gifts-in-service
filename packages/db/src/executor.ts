import {
  BeginTransactionCommand,
  CommitTransactionCommand,
  ExecuteStatementCommand,
  RDSDataClient,
  RollbackTransactionCommand,
  type ExecuteStatementCommandOutput,
  type Field,
  type SqlParameter,
} from "@aws-sdk/client-rds-data";
import pg from "pg";
import { emitMetric } from "@gis/shared";

const DATA_API_RESUME_ATTEMPTS = 8;
const DATA_API_MAX_RESUME_DELAY_MS = 5_000;

export type SqlValue =
  | string
  | number
  | boolean
  | Date
  | null
  | readonly number[]
  | readonly string[];

export interface QueryResult<
  Row extends Record<string, unknown> = Record<string, unknown>,
> {
  rows: Row[];
  rowCount: number;
}

export interface SqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly SqlValue[],
  ): Promise<QueryResult<Row>>;
  transaction<T>(work: (executor: SqlExecutor) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}

export class PostgresExecutor implements SqlExecutor {
  readonly #pool: pg.Pool;
  readonly #client: pg.PoolClient | undefined;

  constructor(
    connectionStringOrPool: string | pg.Pool,
    client?: pg.PoolClient,
  ) {
    this.#pool =
      typeof connectionStringOrPool === "string"
        ? new pg.Pool({ connectionString: connectionStringOrPool })
        : connectionStringOrPool;
    this.#client = client;
  }

  async query<Row extends Record<string, unknown>>(
    sql: string,
    parameters: readonly SqlValue[] = [],
  ): Promise<QueryResult<Row>> {
    const result = await (this.#client ?? this.#pool).query<Row>(
      sql,
      parameters as unknown[],
    );
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  }

  async transaction<T>(
    work: (executor: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    if (this.#client) return work(this);
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(new PostgresExecutor(this.#pool, client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (!this.#client) await this.#pool.end();
  }
}

function dataApiParameter(value: SqlValue, index: number): SqlParameter {
  const name = `p${index + 1}`;
  if (value === null) return { name, value: { isNull: true } };
  if (typeof value === "string") return { name, value: { stringValue: value } };
  if (typeof value === "number")
    return Number.isInteger(value)
      ? { name, value: { longValue: value } }
      : { name, value: { doubleValue: value } };
  if (typeof value === "boolean")
    return { name, value: { booleanValue: value } };
  if (value instanceof Date)
    return {
      name,
      // The RDS Data API TIMESTAMP hint accepts PostgreSQL-style timestamps,
      // not ISO 8601's `T` separator or trailing `Z`.
      value: {
        stringValue: value.toISOString().replace("T", " ").replace(/Z$/u, ""),
      },
      typeHint: "TIMESTAMP",
    };
  return {
    name,
    value: {
      stringValue: `{${value.map((item) => String(item).replaceAll('"', '\\"')).join(",")}}`,
    },
  };
}

function replacePlaceholders(sql: string): string {
  return sql.replace(/\$(\d+)/gu, (_match, number: string) => `:p${number}`);
}

function postgresArray(value: string): string[] {
  if (!value.startsWith("{") || !value.endsWith("}")) return [value];
  const body = value.slice(1, -1);
  if (!body) return [];
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index] ?? "";
    if (character === '"') quoted = !quoted;
    else if (character === "\\" && quoted && index + 1 < body.length)
      current += body[(index += 1)] ?? "";
    else if (character === "," && !quoted) {
      values.push(current);
      current = "";
    } else current += character;
  }
  values.push(current);
  return values;
}

function fieldValue(field: Field, typeName = ""): unknown {
  if (field.isNull) return null;
  if (field.arrayValue?.stringValues) return field.arrayValue.stringValues;
  if (field.arrayValue?.longValues)
    return field.arrayValue.longValues.map(Number);
  if (field.arrayValue?.doubleValues) return field.arrayValue.doubleValues;
  if (field.arrayValue?.booleanValues) return field.arrayValue.booleanValues;
  if (field.stringValue !== undefined) {
    if (/^(?:date|timestamp|timestamptz)/u.test(typeName))
      return new Date(field.stringValue);
    if (typeName.startsWith("_") || typeName.endsWith("[]"))
      return postgresArray(field.stringValue);
    return field.stringValue;
  }
  return (
    field.longValue ??
    field.doubleValue ??
    field.booleanValue ??
    field.blobValue ??
    null
  );
}

export interface DataApiExecutorConfig {
  resourceArn: string;
  secretArn: string;
  database: string;
  region: string;
}

export class DataApiExecutor implements SqlExecutor {
  readonly #client: RDSDataClient;
  readonly #config: DataApiExecutorConfig;
  readonly #transactionId: string | undefined;

  constructor(
    config: DataApiExecutorConfig,
    client = new RDSDataClient({ region: config.region, maxAttempts: 4 }),
    transactionId?: string,
  ) {
    this.#config = config;
    this.#client = client;
    this.#transactionId = transactionId;
  }

  async query<Row extends Record<string, unknown>>(
    sql: string,
    parameters: readonly SqlValue[] = [],
  ): Promise<QueryResult<Row>> {
    const started = Date.now();
    try {
      let response: ExecuteStatementCommandOutput | undefined;
      for (let attempt = 0; attempt < DATA_API_RESUME_ATTEMPTS; attempt += 1) {
        try {
          response = await this.#client.send(
            new ExecuteStatementCommand({
              resourceArn: this.#config.resourceArn,
              secretArn: this.#config.secretArn,
              database: this.#config.database,
              sql: replacePlaceholders(sql),
              parameters: parameters.map(dataApiParameter),
              includeResultMetadata: true,
              transactionId: this.#transactionId,
              formatRecordsAs: "NONE",
            }),
          );
          break;
        } catch (error) {
          const name = error instanceof Error ? error.name : "";
          if (
            !new Set([
              "DatabaseResumingException",
              "DatabaseUnavailableException",
            ]).has(name) ||
            attempt === DATA_API_RESUME_ATTEMPTS - 1
          )
            throw error;
          await new Promise((accept) =>
            setTimeout(
              accept,
              Math.min(250 * 2 ** attempt, DATA_API_MAX_RESUME_DELAY_MS) +
                Math.floor(Math.random() * 150),
            ),
          );
        }
      }
      if (!response) throw new Error("DataApiNoResponse");
      const columns =
        response.columnMetadata?.map((column) => column.name ?? "") ?? [];
      const rows = (response.records ?? []).map((record) =>
        Object.fromEntries(
          columns.map((column, index) => [
            column,
            fieldValue(
              record[index] ?? { isNull: true },
              response.columnMetadata?.[index]?.typeName ?? "",
            ),
          ]),
        ),
      ) as Row[];
      emitMetric(
        "DataApiLatency",
        Date.now() - started,
        "Milliseconds",
        "ExecuteStatement",
      );
      return {
        rows,
        rowCount:
          response.records === undefined
            ? Number(response.numberOfRecordsUpdated ?? 0)
            : rows.length,
      };
    } catch (error) {
      emitMetric("DataApiErrors", 1, "Count", "ExecuteStatement");
      throw error;
    }
  }

  async transaction<T>(
    work: (executor: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    if (this.#transactionId) return work(this);
    const begin = await this.#client.send(
      new BeginTransactionCommand({
        resourceArn: this.#config.resourceArn,
        secretArn: this.#config.secretArn,
        database: this.#config.database,
      }),
    );
    if (!begin.transactionId) throw new Error("DataApiBeginTransactionFailed");
    const transaction = new DataApiExecutor(
      this.#config,
      this.#client,
      begin.transactionId,
    );
    try {
      const result = await work(transaction);
      await this.#client.send(
        new CommitTransactionCommand({
          resourceArn: this.#config.resourceArn,
          secretArn: this.#config.secretArn,
          transactionId: begin.transactionId,
        }),
      );
      return result;
    } catch (error) {
      await this.#client.send(
        new RollbackTransactionCommand({
          resourceArn: this.#config.resourceArn,
          secretArn: this.#config.secretArn,
          transactionId: begin.transactionId,
        }),
      );
      throw error;
    }
  }
}
