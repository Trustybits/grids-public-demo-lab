# Pull Upstream Notes

Note: These notes are in reference to the private repo, not this public repo.

The private repo has a pull-upstream workflow that merges the public repo into the private deploy repo. Normal source files can be pushed with the default `GITHUB_TOKEN` when the workflow has `contents: write`, but GitHub treats files under `.github/workflows/` differently.

If the upstream public repo adds or changes a workflow file, the private repo pull will include that workflow file in the merge. A push made with the default `GITHUB_TOKEN` will then fail with an error like:

```text
refusing to allow a GitHub App to create or update workflow `.github/workflows/test.yml` without `workflows` permission
```

That failure is expected. Updating workflow files requires an actor with workflow-write permission. `contents: write` alone is not enough.

## App Token Workflow

The `pull-upstream-with-permissions.yml` workflow creates a GitHub App installation token and uses that token for checkout and push. The GitHub App should be installed on this private repo and granted only the permissions needed for this sync:

- `Contents: Read and write`
- `Workflows: Read and write`

The workflow expects these repo settings:

- Repository variable: `PULL_UPSTREAM_APP_CLIENT_ID`
- Repository secret: `PULL_UPSTREAM_APP_PRIVATE_KEY`

The private key should be the GitHub App private key in PEM format. The token created from it is short-lived and scoped to the app installation.

Use this workflow when the upstream pull may include `.github/workflows/*` changes. Without the app token and workflow-write permission, the pull can merge locally inside the runner but the final push back to `origin` will be rejected.

## Option B: Do Not Sync Public Workflows

An alternative is to make the private repo own its workflows independently and prevent upstream workflow changes from being pushed into the private repo. In that model, the pull-upstream workflow would need to exclude or revert `.github/workflows/*` changes before pushing.

That avoids needing a GitHub App token with workflow-write permission, but it adds policy complexity:

- Public workflow changes will not automatically reach the private deploy repo.
- The sync script must intentionally handle `.github/workflows/*` every time upstream changes them.
- Conflicts or drift are more likely if both repos evolve their workflows separately.
- Someone still needs to decide which public workflow changes should be manually copied into private.

Use Option B only if the private repo's workflow directory is intentionally different from the public repo's workflow directory. If the private repo is meant to mirror public workflows, the App token approach is simpler and more faithful to the public source of truth.
