import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROLE_SAFETY_CONCERNS } from "../../packages/shared/src/index.js";
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

  it("keeps the database role-safety allowlist aligned with the shared schema", () => {
    const migration = readFileSync(
      resolve("migrations/0013_expand_role_safety_concerns.sql"),
      "utf8",
    );
    expect(migration).toContain(
      `jsonb_array_length(role_safety_concerns) <= ${ROLE_SAFETY_CONCERNS.length}`,
    );
    for (const concern of ROLE_SAFETY_CONCERNS)
      expect(migration).toContain(`"${concern}"`);
  });
});
