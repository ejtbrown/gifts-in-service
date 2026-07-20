# Repository governance

Protect `dev` and `main`: require pull requests, all CI and CodeQL checks, resolved conversations, no force pushes/deletion, and no administrator bypass. The repository has one maintainer, so both branches require zero approving reviews while still requiring the pull-request path and automated checks. `main` additionally requires the promotion-source check, which permits `dev`, `hotfix/*`, and `dependabot/*`.

Terraform dev plans run for same-repository pull requests targeting `dev` and use the read-only state role with `-refresh=false`; forks receive no AWS token. Only resource addresses and actions appear in the workflow summary, and the potentially sensitive binary plan is never uploaded.

CI deploys successful pushes to `dev` automatically. Successful pushes to `main` wait for the sole maintainer's approval in the protected `prod` environment; self-review is intentionally allowed. Environment branch policies restrict `dev` deployments to `dev`, `prod` deployments to `main`, and plan credentials to pull-request merge refs. Update action pins by reviewing upstream release notes and the exact commit, then changing the SHA/comment together.

Merge normal `dev` to `main` promotion pull requests with a merge commit, not squash or rebase, so `dev` remains an ancestor of `main`. Pull requests into `dev` may still be squashed.

Enable GitHub secret scanning/push protection and private vulnerability reporting in repository settings. Dependabot covers npm, Actions and Terraform. Optional Codex review may be enabled through GitHub controls, but CI must never require an OpenAI API key.
