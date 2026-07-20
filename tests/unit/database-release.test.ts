import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface DatabaseRelease {
  aurora_postgresql_version: string;
  aurora_standard_support_end: string;
  local_postgresql_major: number;
}

const repositoryRoot = resolve(import.meta.dirname, "../..");

async function release(): Promise<DatabaseRelease> {
  return JSON.parse(
    await readFile(
      resolve(repositoryRoot, "infra/database-release.json"),
      "utf8",
    ),
  ) as DatabaseRelease;
}

describe("database release lifecycle", () => {
  it("uses Aurora PostgreSQL 17.7 LTS with at least one year of support", async () => {
    const configured = await release();
    expect(configured).toMatchObject({
      aurora_postgresql_version: "17.7",
      local_postgresql_major: 17,
    });
    expect(
      Date.parse(configured.aurora_standard_support_end) - Date.now(),
    ).toBeGreaterThan(365 * 24 * 60 * 60 * 1000);
  });

  it("keeps local, CI, dev, and production database configuration aligned", async () => {
    const configured = await release();
    const [compose, ci, dev, prod] = await Promise.all([
      readFile(resolve(repositoryRoot, "docker-compose.yml"), "utf8"),
      readFile(resolve(repositoryRoot, ".github/workflows/ci.yml"), "utf8"),
      readFile(
        resolve(repositoryRoot, "infra/environments/dev/main.tf"),
        "utf8",
      ),
      readFile(
        resolve(repositoryRoot, "infra/environments/prod/main.tf"),
        "utf8",
      ),
    ]);
    const localImage = `pgvector/pgvector:pg${configured.local_postgresql_major}@sha256:`;
    expect(compose).toContain(localImage);
    expect(ci).toContain(localImage);
    for (const environment of [dev, prod]) {
      expect(environment).toContain(
        "local.database_release.aurora_postgresql_version",
      );
      expect(environment).toContain(
        "local.database_release.aurora_standard_support_end",
      );
    }
  });

  it("keeps the Aurora LTS minor pinned on both the cluster and writer", async () => {
    const databaseModule = await readFile(
      resolve(repositoryRoot, "infra/modules/database/main.tf"),
      "utf8",
    );
    expect(
      databaseModule.match(/auto_minor_version_upgrade\s*=\s*false/gu),
    ).toHaveLength(2);
  });
});
