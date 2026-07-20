#!/usr/bin/env bash
set -euo pipefail

common=(--hidden --glob '!node_modules/**' --glob '!dist/**' --glob '!.git/**' --glob '!**/.terraform/**' --glob '!gifts-in-service-codex-prompt.md' --glob '!pnpm-lock.yaml')

if rg -n "(?:AKIA|ASIA)[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|xox[baprs]-[A-Za-z0-9-]{10,}" "${common[@]}" .; then
  echo 'Potential credential material found.' >&2
  exit 1
fi

if rg -n "(?:localStorage|sessionStorage|indexedDB|dangerouslySetInnerHTML)" "${common[@]}" apps packages services; then
  echo 'A forbidden browser persistence or raw-HTML API is present.' >&2
  exit 1
fi

if rg -n "(?:request|req)\.(?:body|rawBody).*?(?:log|console)|(?:log|console).*?(?:request|req)\.(?:body|rawBody)" "${common[@]}" apps packages services; then
  echo 'Possible request-body logging found.' >&2
  exit 1
fi

if ! rg -q -F 'Dimensions: [["Environment", "Service", "Operation"]]' packages/shared/src/metrics.ts; then
  echo 'CloudWatch EMF dimensions must remain fixed and bounded.' >&2
  exit 1
fi

if rg -n 'CloudWatchMetrics|PutMetricDataCommand' "${common[@]}" apps packages services --glob '!packages/shared/src/metrics.ts'; then
  echo 'CloudWatch custom metrics must use the centralized bounded-dimension emitter.' >&2
  exit 1
fi

echo 'Repository safety scan passed.'
