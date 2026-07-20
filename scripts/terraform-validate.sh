#!/usr/bin/env bash
set -euo pipefail

terraform fmt -check -recursive infra
for directory in infra/bootstrap infra/environments/dev infra/environments/prod; do
  terraform -chdir="$directory" init -backend=false -input=false >/dev/null
  terraform -chdir="$directory" validate
done
