# Repository governance

Protect `main`: require pull requests, CODEOWNERS review for infrastructure/migrations/prompts/workflows, all CI and CodeQL checks, resolved conversations, signed or verified commits where organizational policy supports them, no force pushes/deletion, and no administrator bypass for production changes. Require protected reviewers for `dev-plan`, `dev`, and especially `prod`; restrict environment variable changes and OIDC role use.

Terraform plans run only for same-repository branches and use the read-only state role with `-refresh=false`; forks receive no AWS token. Plan artifacts expire after three days and summaries include resource addresses/actions only. Dev deploys on reviewed `main`; prod is manual and approved. Update action pins by reviewing upstream release notes and the exact commit, then changing the SHA/comment together.

Enable GitHub secret scanning/push protection and private vulnerability reporting in repository settings. Dependabot covers npm, Actions and Terraform. Optional Codex review may be enabled through GitHub controls, but CI must never require an OpenAI API key.
