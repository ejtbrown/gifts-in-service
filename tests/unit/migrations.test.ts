import { describe, expect, it } from "vitest";
import { splitSqlStatements } from "../../services/migration-runner/src/migrations.js";

describe("PostgreSQL migration splitting", () => {
  it("keeps dollar-quoted function bodies and strings intact", () => {
    const source = `BEGIN;
      CREATE FUNCTION example() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'keep; this';
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      INSERT INTO sample(value) VALUES ('one;two');
      COMMIT;`;
    expect(splitSqlStatements(source)).toEqual([
      "BEGIN",
      "CREATE FUNCTION example() RETURNS trigger AS $$\n      BEGIN\n        RAISE EXCEPTION 'keep; this';\n        RETURN NEW;\n      END;\n      $$ LANGUAGE plpgsql",
      "INSERT INTO sample(value) VALUES ('one;two')",
      "COMMIT",
    ]);
  });

  it("does not split semicolons in comments or quoted identifiers", () => {
    expect(
      splitSqlStatements(
        '-- comment;\nCREATE TABLE "odd;name" (value text); /* keep; */ SELECT 1;',
      ),
    ).toHaveLength(2);
  });
});
