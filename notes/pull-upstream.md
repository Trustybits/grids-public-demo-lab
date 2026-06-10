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

## GitHub App Ownership (Personal Account vs Org)

A GitHub App is not an org-only feature. When the private repo is owned by an individual account rather than an organization, the App flow is the same: the App is created under that account's Settings -> Developer settings -> GitHub Apps -> New, installed on the same account, and scoped to the single private repo. The token-minting step, the checkout `token:`, and the `GH_TOKEN` env wiring are byte-for-byte identical to the org case.

Personal-account specifics to keep in mind:

- No org-level secrets. The App Client ID and private key live as repo-level variables/secrets (`PULL_UPSTREAM_APP_CLIENT_ID`, `PULL_UPSTREAM_APP_PRIVATE_KEY`). Fine for a single repo; it just means duplicating them per-repo if the sync is ever extended to more repos.
- Sole admin. The App is tied to the individual account, so if that account goes away, the sync does too.
- When creating the App, leave "Where can this GitHub App be installed?" as "Only on this account", and during installation choose "Only select repositories" and pick the private repo. Private repos are fully supported with no plan-tier restriction.

### Fine-grained PAT alternative

A fine-grained personal access token with `Contents: write`, `Pull requests: write`, and `Workflows: write` can stand in for the App and is faster to set up (no App to create). The trade-offs: it is bound to a user, has a manual expiry that must be rotated, and is broader than ideal. The App installation token auto-expires (about one hour) and is scoped to the installation, so the App is the more durable choice for a daily, workflow-touching sync. A classic (non-fine-grained) PAT would instead need the `workflow` scope for the same workflow-file reason.

## Protected Private Main Branches

If the private repo requires pull requests before merging to `main`, the pull-upstream workflow needs an intentional branch-protection strategy. The existing direct-push shape checks out the target branch, merges the public upstream branch, and pushes the result back to the same private branch. A protected `main` branch with "Require a pull request before merging" will reject that final push unless the workflow actor is allowed to bypass the rule.

There are two valid models:

- Allow the pull-upstream GitHub App to bypass the protected-branch rule and continue pushing directly to `main`.
- Change the workflow so it pushes the upstream merge to a sync branch and opens a pull request into `main`.

The bypass model is simpler operationally. The pull-request model preserves human review for private deploy state.

## Option A: Bypass Private Main Protection

In this model, the private repo keeps `main` protected, but the GitHub App used by `pull-upstream-with-permissions.yml` is added as a bypass actor for the branch protection rule or repository ruleset. The workflow can then keep its current direct-push behavior:

```text
checkout private main
fetch public upstream/main
merge upstream/main
push HEAD back to private main
```

Use this only if upstream syncs are trusted to update private `main` without PR review. That can be reasonable for a tightly controlled mirror, but it means the branch-protection rule will not force a human review on upstream sync changes.

The GitHub App token needs:

- `Contents: Read and write` to check out the private repo and push normal file changes.
- `Workflows: Read and write` if the upstream merge can add or modify files under `.github/workflows/`.

No pull-request permission is needed for this direct-push path because the workflow does not create a PR.

Workflow-file permission is only special on the push back into the private repo. Pulling or fetching workflow files from the public upstream repo is just a normal Git fetch. The failure happens when the workflow tries to push those workflow-file changes into the private repo without workflow-write permission.

## Option B: Open a Pull Request Into Private Main

In this model, the workflow does not bypass private `main` protection. Instead, it creates a sync branch and opens a PR:

```text
checkout private main
fetch public upstream/main
merge upstream/main
push the merge commit to a sync branch
open a PR from the sync branch into private main
```

For example, the sync branch could be named `pull-upstream-main-to-main` or include the workflow run number to avoid collisions. The existing direct-push step:

```sh
git push origin "HEAD:${{ inputs.target_branch }}"
```

would be replaced with a branch push and PR creation step, such as:

```sh
branch="pull-upstream-${{ inputs.upstream_branch }}-to-${{ inputs.target_branch }}"
git checkout -B "$branch"
git push --force-with-lease origin "$branch"

gh pr create \
  --base "${{ inputs.target_branch }}" \
  --head "$branch" \
  --title "Pull upstream ${{ inputs.upstream_branch }} into ${{ inputs.target_branch }}" \
  --body "Merges public upstream changes into the private repo."
```

The GitHub App token needs:

- `Contents: Read and write` to check out the private repo and push the sync branch.
- `Pull requests: Read and write` to create or update the PR.
- `Workflows: Read and write` if the upstream merge can add or modify files under `.github/workflows/`.

The workflow still needs workflow-write permission even though it is pushing to a PR branch instead of directly to `main`. GitHub checks workflow-file updates when they are pushed to the private repo, not only when they land on the protected branch.

The PR method is the better fit if the private repo's `main` branch represents production deploy state and the team wants review before public source changes become private deploy changes.

### The default-token PR setting does not apply here

The repository setting Settings -> Actions -> General -> "Allow GitHub Actions to create and approve pull requests" only governs the default `GITHUB_TOKEN`. Because Option B opens the PR with the GitHub App token, that toggle does not apply and does not need to be enabled. It would only matter if the PR were ever created with `GITHUB_TOKEN` instead of the App token.

### Skipping empty PRs and running on a schedule

Option B can run on a daily `schedule:` cron in addition to `workflow_dispatch`. To avoid opening an empty PR on days when nothing changed upstream, gate the merge and PR steps on whether upstream actually has new commits, checked right after the fetch:

```sh
git fetch upstream "$UPSTREAM"
if [ "$(git rev-list --count HEAD..upstream/$UPSTREAM)" -eq 0 ]; then
  echo "changes=false" >> "$GITHUB_OUTPUT"   # nothing new upstream; exit cleanly
else
  echo "changes=true" >> "$GITHUB_OUTPUT"
fi
```

The create-sync-branch, merge, push, and `gh pr create` steps then run only when `changes == 'true'`. `git rev-list --count HEAD..upstream/<branch>` answers "does upstream have commits the target branch does not"; a count of `0` means there has been no new upstream work since the last pull, so no PR is created.

Scheduled runs do not receive `workflow_dispatch` inputs, so any reference to `inputs.upstream_branch` / `inputs.target_branch` needs a fallback such as `${{ inputs.upstream_branch || 'main' }}` — including the checkout `ref:`.

Duplicate PRs: with a timestamped or run-number sync branch, two scheduled runs before the first PR merges will open two separate PRs. For a single rolling PR instead, use a fixed sync branch name, force-push it, and only call `gh pr create` when one is not already open (`gh pr list --head <branch>`). Timestamped branch names match the existing `infra-sync/<timestamp>` pattern in the repo history.

Merge conflicts: a conflicting `git merge` fails the run and no PR opens, surfacing as a red run to investigate. That "fail loudly" behavior is usually fine; pushing the conflicted branch for manual resolution is the alternative.

## Option C: Do Not Sync Public Workflows

An alternative is to make the private repo own its workflows independently and prevent upstream workflow changes from being pushed into the private repo. In that model, the pull-upstream workflow would need to exclude or revert `.github/workflows/*` changes before pushing.

That avoids needing a GitHub App token with workflow-write permission, but it adds policy complexity:

- Public workflow changes will not automatically reach the private deploy repo.
- The sync script must intentionally handle `.github/workflows/*` every time upstream changes them.
- Conflicts or drift are more likely if both repos evolve their workflows separately.
- Someone still needs to decide which public workflow changes should be manually copied into private.

Use this option only if the private repo's workflow directory is intentionally different from the public repo's workflow directory. If the private repo is meant to mirror public workflows, the App token approach is simpler and more faithful to the public source of truth.
