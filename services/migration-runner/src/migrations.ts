import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { SqlExecutor } from "@gis/db";

/** Split PostgreSQL scripts without breaking strings, comments, or dollar-quoted function bodies. */
export function splitSqlStatements(source: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let dollarTag: string | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (lineComment) {
      current += character;
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      current += character;
      if (character === "*" && next === "/") {
        current += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }
    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) {
        current += dollarTag;
        index += dollarTag.length - 1;
        dollarTag = null;
      } else current += character;
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote && next === quote) {
        current += next;
        index += 1;
      } else if (character === quote) quote = null;
      continue;
    }
    if (character === "-" && next === "-") {
      current += `${character}${next}`;
      index += 1;
      lineComment = true;
      continue;
    }
    if (character === "/" && next === "*") {
      current += `${character}${next}`;
      index += 1;
      blockComment = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if (character === "$") {
      const tag = /^\$[A-Za-z0-9_]*\$/u.exec(source.slice(index))?.[0];
      if (tag) {
        dollarTag = tag;
        current += tag;
        index += tag.length - 1;
        continue;
      }
    }
    if (character === ";") {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
    } else current += character;
  }
  const statement = current.trim();
  if (statement) statements.push(statement);
  return statements;
}

export async function runDataApiMigrations(
  executor: SqlExecutor,
  directory: string,
  dimension: number,
): Promise<string[]> {
  const files = (await readdir(directory))
    .filter((file) => /^\d+.*\.sql$/u.test(file))
    .sort();
  const appliedVersions: string[] = [];
  for (const file of files) {
    const existing = await executor
      .query<{
        applied: boolean;
      }>(
        `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS applied`,
        [file],
      )
      .catch(() => ({ rows: [{ applied: false }], rowCount: 1 }));
    if (existing.rows[0]?.applied) continue;
    const source = (
      await readFile(resolve(directory, file), "utf8")
    ).replaceAll("__EMBEDDING_DIMENSION__", String(dimension));
    const statements = splitSqlStatements(source).filter(
      (sql) =>
        !/^(?:BEGIN|COMMIT)$/iu.test(
          sql.replace(/^(?:--[^\n]*\n\s*)+/u, "").trim(),
        ),
    );
    await executor.transaction(async (transaction) => {
      for (const sql of statements) await transaction.query(sql);
      await transaction.query(
        "INSERT INTO schema_migrations(version) VALUES ($1)",
        [file],
      );
    });
    appliedVersions.push(file);
  }
  return appliedVersions;
}
