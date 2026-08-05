import {
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  utimes,
} from "node:fs/promises";
import { relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { build, type Plugin } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist/lambda");
const entries = {
  "public-api": "services/public-api/src/lambda.ts",
  "staff-api": "services/staff-api/src/lambda.ts",
  "lifecycle-worker": "services/lifecycle-worker/src/lambda.ts",
  "email-events-worker": "services/email-events-worker/src/lambda.ts",
  "reembed-worker": "services/reembed-worker/src/lambda.ts",
  "migration-runner": "services/migration-runner/src/lambda.ts",
} as const;

const archiveTimestamp = new Date("2000-01-01T00:00:00.000Z");

function surfaceIsolationPlugin(name: string): Plugin {
  return {
    name: "api-surface-isolation",
    setup(buildContext) {
      if (name === "public-api") {
        buildContext.onResolve(
          { filter: /^@aws-sdk\/client-cognito-identity-provider$/ },
          () => ({ path: "cognito-unavailable", namespace: "gis-isolation" }),
        );
      }
      if (name === "staff-api") {
        buildContext.onResolve({ filter: /^@gis\/email$/ }, () => ({
          path: "email-unavailable",
          namespace: "gis-isolation",
        }));
      }
      buildContext.onLoad(
        { filter: /.*/, namespace: "gis-isolation" },
        (args) => ({
          loader: "js",
          contents:
            args.path === "cognito-unavailable"
              ? `export class CognitoIdentityProviderClient {}
                 export class AdminAddUserToGroupCommand {}
                 export class AdminCreateUserCommand {}
                 export class AdminDeleteUserCommand {}
                 export class AdminDisableUserCommand {}
                 export class AdminEnableUserCommand {}
                 export class AdminForgetDeviceCommand {}
                 export class AdminListGroupsForUserCommand {}
                 export class AdminRemoveUserFromGroupCommand {}
                 export class AdminUserGlobalSignOutCommand {}
                 export class ListUsersCommand {}
                 export class AdminInitiateAuthCommand {}
                 export class AdminRespondToAuthChallengeCommand {}
                 export class AssociateSoftwareTokenCommand {}
                 export class ConfirmDeviceCommand {}
                 export class ConfirmForgotPasswordCommand {}
                 export class ForgotPasswordCommand {}
                 export class UpdateDeviceStatusCommand {}
                 export class VerifySoftwareTokenCommand {}`
              : `export class MailpitEmailAdapter {}
                 export class SesEmailAdapter {}
                 export function magicLinkEmail() { throw new Error("EmailUnavailableOnStaffApi"); }`,
        }),
      );
    },
  };
}

async function archiveFiles(
  rootDirectory: string,
  directory = rootDirectory,
): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory())
      files.push(...(await archiveFiles(rootDirectory, path)));
    else if (entry.isFile()) files.push(relative(rootDirectory, path));
  }
  return files.sort();
}

async function zip(directory: string, destination: string): Promise<void> {
  const files = await archiveFiles(directory);
  await Promise.all(
    files.map(async (file) => {
      const path = resolve(directory, file);
      await chmod(path, 0o644);
      await utimes(path, archiveTimestamp, archiveTimestamp);
    }),
  );
  await new Promise<void>((accept, reject) => {
    const child = spawn("zip", ["-X", "-q", destination, ...files], {
      cwd: directory,
      env: { ...process.env, TZ: "UTC" },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? accept()
        : reject(new Error(`zip exited with ${code ?? "unknown"}`)),
    );
  });
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const [name, entry] of Object.entries(entries)) {
  const staging = resolve(output, `.stage-${name}`);
  await mkdir(resolve(staging, "app"), { recursive: true });
  await build({
    entryPoints: [resolve(root, entry)],
    outfile: resolve(staging, "app/index.mjs"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    minify: true,
    plugins: [surfaceIsolationPlugin(name)],
    sourcemap: false,
    legalComments: "none",
    define:
      name === "public-api" || name === "staff-api"
        ? {
            "process.env.GIS_API_SURFACE": JSON.stringify(
              name === "public-api" ? "public" : "staff",
            ),
          }
        : {},
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    },
  });
  const bundle = await readFile(resolve(staging, "app/index.mjs"), "utf8");
  const forbiddenMarkers =
    name === "public-api"
      ? [
          "/api/staff/access/:sub/groups",
          "/api/staff/auth/login",
          "AdminCreateUserCommand",
        ]
      : name === "staff-api"
        ? [
            "/api/member/emails/:id/primary",
            "/api/member/profiles/select",
            "SendEmailCommand",
          ]
        : [];
  const leakedMarker = forbiddenMarkers.find((marker) =>
    bundle.includes(marker),
  );
  if (leakedMarker)
    throw new Error(`${name} bundle contains forbidden surface marker`);
  if (name === "public-api" || name === "staff-api") {
    await cp(
      resolve(root, "packages/ai/prompts"),
      resolve(staging, "prompts"),
      { recursive: true },
    );
  }
  if (name === "migration-runner") {
    await cp(resolve(root, "migrations"), resolve(staging, "migrations"), {
      recursive: true,
    });
  }
  await zip(staging, resolve(output, `${name}.zip`));
  await rm(staging, { recursive: true, force: true });
}
