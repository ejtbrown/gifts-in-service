import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgresExecutor } from "@gis/db";
import { loadConfig } from "@gis/shared";
import { seed } from "./seed.js";

const repositoryRoot = resolve(
  fileURLToPath(new URL("../../../", import.meta.url)),
);

async function migrate(
  executor: PostgresExecutor,
  dimension: number,
): Promise<void> {
  const directory = resolve(repositoryRoot, "migrations");
  const migrations = (await readdir(directory))
    .filter((file) => /^\d+.*\.sql$/u.test(file))
    .sort();
  for (const migration of migrations) {
    const applied = await executor
      .query<{ applied: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations'
        ) AND CASE WHEN to_regclass('schema_migrations') IS NULL THEN false ELSE EXISTS (
          SELECT 1 FROM schema_migrations WHERE version = $1
        ) END AS applied`,
        [migration],
      )
      .catch(() => ({ rows: [{ applied: false }], rowCount: 1 }));
    if (applied.rows[0]?.applied) continue;
    const sql = (
      await readFile(resolve(directory, migration), "utf8")
    ).replaceAll("__EMBEDDING_DIMENSION__", String(dimension));
    await executor.query(sql);
    await executor.query(
      "INSERT INTO schema_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING",
      [migration],
    );
    process.stdout.write(`Applied ${migration}\n`);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const executor = new PostgresExecutor(config.DATABASE_URL);
  try {
    const command = process.argv[2] ?? "migrate";
    if (command === "migrate")
      await migrate(executor, config.EMBEDDING_DIMENSION);
    else if (command === "seed")
      await seed(
        executor,
        config.EMBEDDING_DIMENSION,
        config.EMBEDDING_MODEL_ID,
      );
    else throw new Error(`Unknown migration-runner command: ${command}`);
  } finally {
    await executor.close();
  }
}

await main();
