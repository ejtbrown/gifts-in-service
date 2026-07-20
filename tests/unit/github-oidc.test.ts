import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

describe("GitHub OIDC bootstrap trust", () => {
  it("supports immutable owner and repository IDs in every trusted subject", async () => {
    const [main, variables] = await Promise.all([
      readFile(resolve(repositoryRoot, "infra/bootstrap/main.tf"), "utf8"),
      readFile(resolve(repositoryRoot, "infra/bootstrap/variables.tf"), "utf8"),
    ]);

    expect(variables).toContain('variable "github_repository_ids"');
    expect(main).toContain(
      "github_oidc_repository_name = var.github_repository_ids == null",
    );
    expect(main).toContain(
      "${var.github_repository_ids.owner_id}/${local.github_repository_segments[1]}@${var.github_repository_ids.repository_id}",
    );
    expect(
      main.match(
        /repo:\$\{local\.github_oidc_repository_name\}:environment:/gu,
      ),
    ).toHaveLength(2);
  });

  it("allows Terraform to manage the CloudFront web ACL", async () => {
    const main = await readFile(
      resolve(repositoryRoot, "infra/bootstrap/main.tf"),
      "utf8",
    );

    expect(main).toContain('"wafv2:*"');
  });

  it("grants only the S3 operations needed by Terraform and asset sync", async () => {
    const main = await readFile(
      resolve(repositoryRoot, "infra/bootstrap/main.tf"),
      "utf8",
    );
    const deployPolicy = main.match(
      /data "aws_iam_policy_document" "deploy" \{[\s\S]*?\n\}/u,
    )?.[0];

    expect(deployPolicy).toBeDefined();
    expect(deployPolicy).not.toContain('"s3:*"');
    expect(deployPolicy).toContain('"s3:ListBucket"');
    expect(deployPolicy).toContain('"s3:PutObject"');
    expect(deployPolicy).toContain('"s3:DeleteObject"');
  });
});
