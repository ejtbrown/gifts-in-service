# ADR 0002: Promote environment branches

## Status

Accepted.

## Context

Development needs fast deployment feedback, while production changes require an
explicit release decision. Direct pushes and independently running deployment
workflows could bypass validation or deploy a commit whose complete test suite
was still running.

This repository has one maintainer. Pull requests and status checks must remain
mandatory, but a required second-person review would prevent the maintainer from
shipping changes.

## Decision

`dev` is the desired state of the development environment and `main` is the
desired state of production. Feature and routine dependency changes enter
`dev` through pull requests. The normal production promotion is a pull request
from `dev` to `main`; `hotfix/*` and `dependabot/*` are explicit exceptional
sources and must be reconciled back into `dev`.

Both long-lived branches require pull requests and successful automated checks,
with zero required approving reviews. CI deploys a push to `dev` automatically
only after application and infrastructure validation succeeds. A successful
push pipeline on `main` reaches the protected `prod` environment, where the
maintainer must approve the deployment. Production permits self-approval
because the repository has one maintainer.

Deployments consume artifacts produced by the successful application job for
the same commit. Environment branch policies bind `dev` deployments to `dev`
and `prod` deployments to `main`. OIDC roles and variables remain scoped to
their corresponding GitHub environments.

## Consequences

Development receives automatic deployments from reviewed, green commits.
Production has a visible pause and deployment record without requiring a second
maintainer. `main` can temporarily be ahead of the live environment while a
deployment waits for approval; the latest successful production deployment SHA
is the record of what is actually live.

Long-lived branches can drift. Production hotfixes and direct Dependabot
security promotions therefore require a follow-up merge into `dev`. Reverting a
deployment is performed as a reviewed commit rather than by selecting an
arbitrary branch or environment in a manual workflow.
