import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

describe("infrastructure security invariants", () => {
  it("overrides vulnerable transitive releases", async () => {
    const workspace = await readFile(
      resolve(repositoryRoot, "pnpm-workspace.yaml"),
      "utf8",
    );

    expect(workspace).toContain('"fast-uri@^3.0.0": 3.1.8');
    expect(workspace).toContain('"fast-uri@^4.0.0": 4.2.1');
    expect(workspace).toContain('"ip-address@^10.2.0": 10.7.3');
  });

  it("keeps CodeQL actions on one immutable release", async () => {
    const [workflow, dependabot] = await Promise.all([
      readFile(resolve(repositoryRoot, ".github/workflows/codeql.yml"), "utf8"),
      readFile(resolve(repositoryRoot, ".github/dependabot.yml"), "utf8"),
    ]);
    const actionPins = [
      ...workflow.matchAll(
        /github\/codeql-action\/(?:init|analyze)@([a-f0-9]{40})/gu,
      ),
    ].map((match) => match[1]);

    expect(actionPins).toHaveLength(2);
    expect(new Set(actionPins)).toHaveLength(1);
    expect(dependabot).toContain('patterns: ["github/codeql-action/*"]');
  });

  it("requires the modern TLS policy on custom certificates", async () => {
    const [edge, application, planWorkflow] = await Promise.all([
      readFile(
        resolve(repositoryRoot, "infra/modules/storage-edge/main.tf"),
        "utf8",
      ),
      readFile(
        resolve(repositoryRoot, "infra/modules/application/main.tf"),
        "utf8",
      ),
      readFile(
        resolve(repositoryRoot, ".github/workflows/terraform-plan.yml"),
        "utf8",
      ),
    ]);

    expect(edge).toContain(
      'var.custom_domain_name == "" ? "TLSv1" : "TLSv1.2_2021"',
    );
    expect(application).toContain(
      "aws_acm_certificate_validation.custom[0].certificate_arn",
    );
    expect(application).toMatch(
      /resource "aws_route53_record" "custom_ipv6"[\s\S]*?type\s+=\s+"AAAA"/u,
    );
    expect(planWorkflow).toContain(
      "TF_VAR_custom_domain_name: ${{ vars.CUSTOM_DOMAIN_NAME }}",
    );
    expect(planWorkflow).toContain(
      "TF_VAR_route53_zone_id: ${{ vars.ROUTE53_ZONE_ID }}",
    );
  });

  it("keeps SPA routing separate from API errors and canonicalizes the viewer host", async () => {
    const edge = await readFile(
      resolve(repositoryRoot, "infra/modules/storage-edge/main.tf"),
      "utf8",
    );

    expect(edge).toContain(
      'resource "aws_cloudfront_function" "viewer_request"',
    );
    expect(edge.match(/function_association \{/gu)).toHaveLength(2);
    expect(edge).not.toContain("custom_error_response");
    expect(edge).toContain("viewer-request.js.tftpl");
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
