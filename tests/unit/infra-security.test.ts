import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

describe("infrastructure security invariants", () => {
  it("requires the modern TLS policy on custom certificates", async () => {
    const edge = await readFile(
      resolve(repositoryRoot, "infra/modules/storage-edge/main.tf"),
      "utf8",
    );

    expect(edge).toContain(
      'var.custom_domain_name == "" ? "TLSv1" : "TLSv1.2_2021"',
    );
  });

  it("fails production planning without a custom domain and managed DNS zone", async () => {
    const [application, variables] = await Promise.all([
      readFile(
        resolve(repositoryRoot, "infra/modules/application/main.tf"),
        "utf8",
      ),
      readFile(
        resolve(repositoryRoot, "infra/environments/prod/variables.tf"),
        "utf8",
      ),
    ]);

    expect(application).toContain(
      'error_message = "Production blocked: a valid custom domain',
    );
    expect(
      variables.match(/variable "(?:custom_domain_name|route53_zone_id)"/gu),
    ).toHaveLength(2);
    expect(variables).not.toMatch(
      /variable "(?:custom_domain_name|route53_zone_id)" \{[\s\S]*?default\s*=\s*""/u,
    );
  });

  it("isolates Lambda configuration and AWS privileges by service", async () => {
    const api = await readFile(
      resolve(repositoryRoot, "infra/modules/api/main.tf"),
      "utf8",
    );

    expect(api).toContain("variables = local.function_environments[each.key]");
    expect(api).not.toContain("local.common_environment");
    expect(api).toContain('for_each = toset(["public", "lifecycle"])');
    expect(api).toMatch(/role\s*=\s*aws_iam_role\.function\["staff"\]\.id/u);
    expect(api).toMatch(/role\s*=\s*aws_iam_role\.function\["reembed"\]\.id/u);
    expect(api).toContain('Action = ["bedrock:InvokeModel"]');
  });

  it("enables opt-in Cognito device trust with narrowly bounded revocation", async () => {
    const [cognito, api, bootstrap] = await Promise.all([
      readFile(
        resolve(repositoryRoot, "infra/modules/cognito/main.tf"),
        "utf8",
      ),
      readFile(resolve(repositoryRoot, "infra/modules/api/main.tf"), "utf8"),
      readFile(resolve(repositoryRoot, "infra/bootstrap/main.tf"), "utf8"),
    ]);

    expect(cognito).toContain("challenge_required_on_new_device      = true");
    expect(cognito).toContain("device_only_remembered_on_user_prompt = true");
    expect(api).toContain('"cognito-idp:AdminForgetDevice"');
    expect(bootstrap).toContain('"cognito-idp:AdminForgetDevice"');
  });

  it("alarms on authentication, authorization, and rate-limit rejection spikes", async () => {
    const observability = await readFile(
      resolve(repositoryRoot, "infra/modules/observability/main.tf"),
      "utf8",
    );

    for (const metric of [
      "AuthenticationFailures",
      "AuthorizationDenials",
      "RateLimitRejections",
    ]) {
      expect(observability).toContain(metric);
    }
    expect(observability).toContain(
      'resource "aws_cloudwatch_metric_alarm" "security_events"',
    );
    expect(observability).not.toContain("metrics = flatten([");
    expect(observability).toContain(
      'for pair in setproduct(["public", "staff"], keys(local.security_event_types))',
    );
  });
});
