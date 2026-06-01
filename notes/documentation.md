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
