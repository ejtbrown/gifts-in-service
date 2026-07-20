#!/usr/bin/env bash
set -euo pipefail

common=(--exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=.terraform --exclude=gifts-in-service-codex-prompt.md --exclude=pnpm-lock.yaml)

if grep -RInE "${common[@]}" "(AKIA|ASIA)[A-Z0-9]{16}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|xox[baprs]-[A-Za-z0-9-]{10,}" .; then
  echo 'Potential credential material found.' >&2
  exit 1
fi

if grep -RInE "${common[@]}" "(localStorage|sessionStorage|indexedDB|dangerouslySetInnerHTML)" apps packages services; then
  echo 'A forbidden browser persistence or raw-HTML API is present.' >&2
  exit 1
fi

if grep -RInE "${common[@]}" "(request|req)\.(body|rawBody).*(log|console)|(log|console).*(request|req)\.(body|rawBody)" apps packages services; then
  echo 'Possible request-body logging found.' >&2
  exit 1
fi

if ! grep -qF 'Dimensions: [["Environment", "Service", "Operation"]]' packages/shared/src/metrics.ts; then
  echo 'CloudWatch EMF dimensions must remain fixed and bounded.' >&2
  exit 1
fi

if grep -RInE "${common[@]}" 'CloudWatchMetrics|PutMetricDataCommand' apps packages services |
  grep -vF 'packages/shared/src/metrics.ts:'; then
  echo 'CloudWatch custom metrics must use the centralized bounded-dimension emitter.' >&2
  exit 1
fi

echo 'Repository safety scan passed.'
