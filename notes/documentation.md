# Some hand-written documentation on the public/private repos and what the demo covers

### Involved repos

The demo involves two separate repos under the Trustybits organization, the grids-public-demo-lab and
grids-private-demo-lab. There is also a third repository under the dummy tylerdemo936-lgtm account called
grids-fork-demo-lab.

In this model, each of the three repos demonstrate a specific purpose. The forked repo represents a forked
contributor's repo, and demonstrates the contributor's potential workflow when opening a PR into the
main repo. The public repo serves as the "main" repo, and the source of truth for most code in the repo.
It is in the public repo that most development takes place. The private repo is the deployment repo from which
Firebase and Vercel deploy. It is a near-identical mirror to the public repo, with the exception that it contains
Firebase-specific files like `.firebaserc` and `firestore.rules`, among other, committed. The public repo does
not contain these files.

### Interactions between the repos

The developer workflow goes as follows:

1. Branch is created in the grids-public-demo-lab repo.
2. Changes are made, tested, and committed.
3. A PR is opened into the main branch of the grids-public-demo-lab repo.
4. The PR is approved (see more below) and merged

In general, that's it. A scheduled workflow in the grids-private-demo-lab repo will periodically pull the latest changes
from the public repo and deploy.

If a developer needs to change an "infrastructure" file like `.firebaserc`, this must be done in the grids-private-demo-lab
repo. In that repo, they follow the above steps (1-4), but the private repo is not synced back to the public repo.

The contributor workflow goes as follows:

1. The contributor forks the repo.
2. The contributor makes branches (if desired) and makes changes (ideally testing them as well).
3. If the contributor wishes to have their changes brought back to the main public repo, they open a PR from their
repo/branch to the public repo.
4. Tests and automated workflows run on the PR. The contributor cannot merge their own code into the grids-public-demo-lab
repo.
5. A maintainer (anyone who is part of the Trustybits organization and has the appropriate permissions) can review, approve,
and merge the contributor's PR into the public repo.

The same scheduled workflow will bring any changes on the main branch of grids-public-demo-lab into the private repo for
deployment.

Note: Using this architectures means that the firebase configuration files, like `firestore.rules`, are not present in the
public repo and therefore are not present in any forked repo. The firebase configuration files are not inherently secret - they
are public and shipped with the build to the browser, so a determined third party could get all of the information that's in
them. Secrets should (and are) managed in appropriate locations, and Firebase itself should block requests coming from an
inappropriate domain. This means that contributors cannot run emulators or test against Firebase. There is no clean way
to include firebase files designed for only emulators and not the real thing, or vice-versa.

Thus, the decision to exclude the firebase configuration files is not one of security, but simply one of opinion. Do we 
want to include the firebase (and vercel) files in the public repo? Pointing the deployments at the public repo is also
safe, though does contain more *potential* risk than pointing them at a private repo.

### Security

The public repo, regardless of whether there is a private repo or not, should have branch protections enabled for the
main branch. This is both to help prevent malicious attacks (unlikely but possible) and good hygiene. Branch protections
on main would include some of the following (there is a disabled ruleset called "protect main" on the grids-public-demo-lab
with some configurations for branch protection):

- Branch targeting: "main" (only targets the main branch)
- Restrict deletions
- Require a pull request before merging (cannot commit directly to main, must commit to a feature branch then PR)
- Require status checks to pass (with all testing/validation workflows selected) (ensures that you may only merge the PR
when all checks pass, any failing checks block the merge)
- Block force pushes (no force pushes, which prevents history from being overwritten)
- Require reviewers (1+) (requires 1 or more authorized individuals to review the code before merging)
- Additional settings and sub-settings as set on the ruleset

See "Recommended Branch Security Ruleset" below for the recommended ruleset

**Version bump script**

With branch protections on main enabled, this changes how the version-bump script would work. Instead of committing
directly to main, the version bump script would have to create and submit a PR which would have to be manually
reviewed. Additionally, since the status checks are required to merge a PR, the version-bump script would need access
to a special token to ensure that those checks run. This is because any PR created by a workflow using the standard
github token does *not* trigger other workflows. This special token should be generated by an App attached to the 
repo, with details and alternatives outlined in `app-token-setup.md`, along with other security concerns (and how
they are addressed) around workflows. The new version bump script should additionally update the lockfile keeping
it in sync with the version number, and can only open 1 PR at a time regardless of how many or how quickly the
workflow is triggered.

### How the private repo pulls the changes from the public repo

For the private repo to pull changes from the public repo, it must set the public repo as an upstream repository. The private
repo *cannot* be a fork of the public repo because forks inherit the visibility setting of the parent and cannot change it.
Once the public repo is set as an upstream, the private repo can pull and merge from the public using simple git commands.
These should be encapsulated in a private-only workflow that pulls the public repo's changes on a schedule. Alternatively,
there can be a workflow set up on the public repo that triggers the private repo's workflow, but this requires additional
tokens allowing the public repo to access the private repo's workflow.

Additionally, the private repo workflow to pull the changes will require its own App and token, because by default the github
token does not allow writing to the workflows file. Details about this are outlined in the `pull-upstream.md` file.

The private repo should have all of the code that the public repo does. The private repo may have *additional* files not
present in the public repo, but it must not match or collide with any paths in the public repo. 

### Extras

Workflows in the public repo will be present in the private repo. Thus, workflows only intended to run in the public repo
(like the version bump) must be guarded to only run in that repo. This applies to contributions as well.


### Recommended Branch Security Ruleset

Definitely Include (likely on both public and private repos):

- Restrict deletions (cannot delete main, for obvious reasons)
- Require a pull request before merging (block direct commits on main to control how code gets into main)
  - Required Approvals: 1 (require at least 1 maintainer to approve the code, at this size of a repo 1 is probably enough)
  - Dismiss stale PR approvals when new commits are pushed (if the PR was approved and new changes are pushed into the PR,
  this will reset the approval status and require approval again, since new code was introduced)
  - Require conversation resolution before merging (if a review conversation is ongoing, it must be resolved before merging.
  This is so that any maintainer concerns are resolved prior to the merge)
  - Allowed merge methods: Merge, Squash, Rebase (narrow if we only want some or one of these)
- Require Status Checks to Pass (this requires our CI workflows to pass before a merge is allowed, thus preventing issues)
- Block force pushes (force pushes rewrite git history, blocking this prevents rewriting of history)


Optional/Unnecessary:

- merge queue (too much complexity and churn for our repo, we don't have PRs happening often enough to merit this. Essentially,
more trouble than what it's worth at the current moment. If traffic becomes high and PRs are happening frequently (like many
a day) then look into this option)
- Restrict creations (prevents people from creating a branch named 'main', which already can't be done anyways since main exists)
- Restrict updates (prevents people without bypass permissions from updating main. Likely unnecessary because we already require
PRs before merging)
- Require linear history (prevents merge commits from entering the branch, must be rebase or squash. Unnecessary unless we don't
want merge commits)
- Require deployments to succeed (this is useful if the PR must deploy to a staging environment, not production, before we merge
it in. This could be useful if we set up a staging environment for testing and QA, and requiring it to deploy successfully to
that environment makes sense. This would incur the cost of setting up and using that staging environment, which may or may not
be worth it at this scale. Worth a further look, but if we do not have a staging environment this should remain off)
- Require signed commits (requires a cryptographic signature on each commit, which requires additional setup for each developer.
Unnecessary at the current point in time, likely more trouble than it's worth).
- Require review from specific teams (under the require PR settings) (Assigns required reviewers based on file patterns, so
you can assign specific reviewers if specific kinds of files were changed. Likely unnecessary since we don't have clear
ownership boundaries in the code, and the codebase is small enough a single general reviewer (from the settings above) is 
probably sufficient)
- Require review from Code Owners (uses the CODEOWNERS.md file, which defines specific file and their owners. Similar to requiring
a review from a team, except using the CODEOWNERS document. Unnecessary for the same reasons as the previous)
- Require branches to be up to date before merging (again, at our current scale this is unnecessary and likely creates more
trouble than what it's worth. If we see issues where CI passes on the PR but then fails after the merge, then enable this)
- Do not require status checks on creation (This is unnecessary since these protections target `main` and only `main`, so
no one will be creating another branch called `main`, which is when this would apply)
- Require code scanning results (We don't have any code scanning tools configured, so unless we wanted to add a code scanning
tool this is unnecessary)
- Require code quality results (We don't have any code quality tools configured, so unless we wanted to add a code quality tool
this is unnecessary)
- Automatically request Copilot code review (Automatically requests a review from Copilot, which uses the PR author's Copilot
quota, and likely requires a paid version of Copilot. Probably unnecessary at this point in time)
- The Restrictions section is Enterprise, and so currently inaccessible. These settings include Restrict commit metadata
and Restrict branch names. Restric commit metadata is currently unnecessary, and restrict branch names is not applicable
because this ruleset only targets "main"
