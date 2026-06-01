# App Token Setup for the Version Bump Workflow

This document explains how the automated version-bump workflow authenticates,
how to set up the GitHub App that provides that authentication, and the design
decisions (recursion guards, fork safety) that make the workflow safe to ship in
a public, forkable repository.

---

## Why a special token is necessary at all

The version-bump workflow opens a pull request automatically. For that PR to be
mergeable, your branch protection requires the **Test** workflow to pass on it.

GitHub enforces a hard platform rule:

> Events triggered by the repository's built-in `GITHUB_TOKEN` (with the
> exception of `workflow_dispatch` and `repository_dispatch`) **do not create new
> workflow runs.**

This rule exists to stop workflows from recursively triggering themselves. The
consequence: if the bump workflow opened its PR using `GITHUB_TOKEN`, GitHub
would create the PR but **suppress** the `pull_request` event, so **Test would
never run on the bump PR** and the required status check would sit unfilled
forever. The PR could never be merged.

The fix is to open the PR using a **different identity** — one that is *not* the
built-in `GITHUB_TOKEN`. Events created by that identity *do* trigger workflows,
so Test runs on the bump PR and branch protection is satisfied. That identity can
be a Personal Access Token (PAT) or a **GitHub App**. We use a GitHub App.

---

## How the token is obtained (the "bump token")

With the App approach there is **no long-lived token stored in the repo**. You do
not store a `BUMP_TOKEN` secret. Instead you store the App's identity
(`BUMP_APP_ID`) and its signing key (`BUMP_APP_PRIVATE_KEY`), and the workflow
**mints a short-lived token at runtime** from those two values:

```yaml
- name: Generate App token
  id: app-token
  uses: actions/create-github-app-token@v2
  with:
    app-id: ${{ secrets.BUMP_APP_ID }}
    private-key: ${{ secrets.BUMP_APP_PRIVATE_KEY }}
```

The minted token is then referenced as `${{ steps.app-token.outputs.token }}`.
It lives for about an hour and is automatically discarded when the job ends. This
runtime-minted token is the "bump token" the rest of the workflow uses to push the
branch and open the PR.

---

## Setting up the GitHub App

### 1. Register the App

Create it under the **organization** (so it is org-owned, not tied to a personal
account):

- **Org → Settings → Developer settings → GitHub Apps → New GitHub App.**
- **GitHub App name:** globally unique, e.g. `trustybits-version-bumper`.
- **Homepage URL:** anything (the repository URL is fine).
- **Webhook:** uncheck **Active** — the App does not need to receive webhooks.
- **Repository permissions** (this is the important part — grant the minimum):
  - **Contents:** Read and write
  - **Pull requests:** Read and write
  - **Metadata:** Read-only (selected automatically)
  - Everything else: **No access**.
- **Where can this app be installed:** "Only on this account".
- Click **Create GitHub App.**

### 2. Generate credentials

On the App's settings page:

- Note the **App ID** (a number near the top of the General page).
- Scroll to **Private keys → Generate a private key**. This downloads a `.pem`
  file. You will paste its entire contents (including the
  `-----BEGIN ... PRIVATE KEY-----` / `-----END ... PRIVATE KEY-----` lines) as a
  secret. Treat this file as sensitive — anyone with it can mint tokens for the
  repos the App is installed on.

### 3. Install the App

- On the App's page → **Install App** (left sidebar) → install on **Trustybits**.
- Choose **Only select repositories** → select **`grids-public-demo-lab`**.

### 4. Store the secrets

Repo → **Settings → Secrets and variables → Actions → Secrets**:

| Secret name             | Value                                              |
| ----------------------- | -------------------------------------------------- |
| `BUMP_APP_ID`           | The numeric App ID.                                |
| `BUMP_APP_PRIVATE_KEY`  | The full contents of the downloaded `.pem` file.   |

The App ID is not especially sensitive; the private key absolutely is.

---

## How the version bump works, end to end

1. A normal change is merged to `main` → a `push` to `main` occurs.
2. The **Test** workflow runs and passes.
3. The **Version Bump** workflow is triggered (via `workflow_run` on Test
   completing). It checks its guards (see below), and if it should proceed:
   - mints an App token,
   - runs `scripts/bump-version.mjs` to bump the version in `package.json` and
     `package-lock.json`,
   - commits as `Bump version to: <version>` on a `version-bump-<version>`
     branch, pushes it, and opens a PR against `main` — **using the App token**.
4. Because the PR was opened by the App (not `GITHUB_TOKEN`), the **Test**
   workflow runs on the bump PR via the `pull_request` event, satisfying branch
   protection.
5. A maintainer reviews and merges the bump PR. The recursion guards (below)
   ensure that merge does not kick off an endless bump-test-bump cycle.

> **Version scheme:** the patch number increases by 1 each bump; once the patch
> would reach 25, the minor is incremented and the patch resets to 0
> (e.g. `0.0.24 → 0.1.0`).

---

## PAT vs. GitHub App: pros and cons

Both a fine-grained PAT and a GitHub App solve the core problem (an identity that
is not `GITHUB_TOKEN`, so the bump PR triggers Test). They differ in operational
and security properties.

| Property                         | Fine-grained PAT                                  | GitHub App                                             |
| -------------------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| **Identity**                     | Tied to a specific person's account               | Impersonal, org-owned bot                              |
| **Survives maintainer turnover** | No — breaks if that person leaves/loses access    | Yes                                                    |
| **Expiry**                       | Forced (max 1 year) → recurring breakage          | Private key does not expire; minted tokens last ~1h    |
| **Rotation**                     | That person must regenerate it                    | Any org admin rotates the key; no individual involved  |
| **Leak blast radius**            | Standing token, valid until revoked/expired       | Short-lived minted tokens; revoke by rotating the key  |
| **Scope**                        | Repo + chosen permissions                         | Repo + chosen permissions (same minimum)               |
| **Setup effort**                 | ~2 minutes, one secret                            | ~10 minutes, App registration + install + two secrets  |
| **Triggers Test on the bump PR** | Yes                                               | Yes                                                    |

**Why the App is preferred here:** this is a public, community-oriented
repository. A PAT ties the release automation to one human's credential — if they
leave, rotate their token, or it expires, bumps silently stop. The App decouples
the automation from any individual, uses short-lived tokens, and is rotatable by
the org without a person in the loop. A PAT is perfectly fine for a private repo
with a single stable owner, but on a forkable public project the App is the more
durable and lower-risk choice.

---

## Recursion guards

Opening a PR (rather than pushing straight to `main`) introduces a merge step
that could, in principle, start an infinite cycle: bump → Test → bump → Test …
Several independent guards prevent this, so it is safe under **any** merge
strategy (squash, rebase, or merge commit).

1. **Trigger filter on the Version Bump workflow.** The bump job only runs when
   the triggering Test run was a `push` to `main`:

   ```yaml
   if: >-
     github.repository == 'Trustybits/grids-public-demo-lab' &&
     github.event.workflow_run.conclusion == 'success' &&
     github.event.workflow_run.head_branch == 'main' &&
     github.event.workflow_run.event == 'push'
   ```

   The bump PR's own Test run is a `pull_request` event on a `version-bump-*`
   branch, so it fails this filter — **the bump PR cannot trigger another bump.**

2. **Commit-message skip in `test.yml`.** On a `push`, Test is skipped if the head
   commit message starts with `Bump version to:`:

   ```yaml
   if: ${{ github.event_name != 'push' || !startsWith(github.event.head_commit.message, 'Bump version to:') }}
   ```

   So a squash- or rebase-merged bump (whose commit message is preserved) does not
   even run Test on `main`, and therefore cannot trigger another bump. (Pull
   requests always run Test, because `head_commit` is only set on pushes.)

3. **Version-only diff guard inside the bump job.** If the merge produced a merge
   commit (whose message is *not* `Bump version to:`), Test does run and the bump
   job is triggered — but it then inspects the triggering commit and bails out if
   the only change was the version fields:

   ```bash
   # Skip if the commit touched only package.json + package-lock.json
   # and only the "version" line within package.json.
   ```

   A bump commit matches that shape, so `should_bump=false` and **no new PR is
   created.** This catches the merge-commit case that guard #2 misses.

4. **"Already open" guard + concurrency.** Before creating a PR, the job checks
   whether an open `version-bump-*` PR already exists and skips if so, and a
   `concurrency: { group: version-bump }` block serializes runs. Together these
   stop duplicate/competing bump PRs.

Any one of guards #1–#3 is sufficient to break the cycle; having all three makes
the workflow robust regardless of how the bump PR is merged.

---

## Forks: why they can't run the bump or merge their own PRs — and why that matters

This repository is public and intended to be forked. The workflow is designed so
that forks inherit it harmlessly.

### Forks cannot run the version bump

Two layers stop this:

- **Secrets are never shared with forks.** `BUMP_APP_ID` and
  `BUMP_APP_PRIVATE_KEY` do not exist in a fork, so a fork could not mint an App
  token even if the job ran.
- **The repository guard short-circuits the job.** The bump job's `if:` requires
  `github.repository == 'Trustybits/grids-public-demo-lab'`. In any fork this is
  `false`, so the entire job is skipped — it never reaches the token step, and the
  fork sees no errors. The automation is simply inert.

A fork owner who *wants* version bumping in their own fork changes that repository
name to their own and supplies their own App/secrets. This is the intended,
explicit opt-in.

### Forks cannot merge their own PRs into this repo

- An external contributor opening a PR **from their fork** does not have write
  access to this repository, and branch protection requires passing checks (and
  typically review) before merge. They cannot merge it themselves.
- Crucially, **pull requests triggered by a fork run with a read-only token and no
  access to secrets.** So a fork PR cannot obtain a privileged token, cannot mint
  an App token, and cannot drive any step that would push to or merge into the
  protected `main` branch.
- The bump workflow itself never auto-merges anything — it only *opens* a PR for a
  maintainer to review and merge.

### Why this separation is necessary

The Version Bump workflow uses `on: workflow_run`, which is special: it runs in
**this (base) repository's context with access to secrets**, even when the Test
run that triggered it originated from fork activity. On a public repo that is a
well-known footgun. The design neutralizes it:

- The trigger guards (`repository ==`, `event == 'push'`, `head_branch == 'main'`)
  mean a fork PR's Test run never starts the privileged bump job.
- The job checks out `ref: main` — **trusted base-repo code** — and never the PR's
  head. So untrusted, fork-contributed code is never executed while the App
  credentials are in scope.

Without these protections, a malicious fork PR could potentially coerce a
privileged, secret-bearing workflow into running attacker-controlled code — which
could exfiltrate the App private key or push directly to the protected branch.
Keeping the bump strictly scoped to the canonical repository, gated on trusted
events, and checking out only trusted code is what makes it safe to expose this
automation in a public, forkable project.
