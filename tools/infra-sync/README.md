# Private Infrastructure Sync

This tool compares local Firebase infrastructure files in this public checkout against the tracked copies in a private deployment repo. If differences exist, it can open a pull request in the private repo with the local versions.

## Setup

Copy the example config and fill in the private repo:

```bash
cp tools/infra-sync/infra-sync.config.example.json tools/infra-sync/infra-sync.config.json
```

The real config is gitignored because it may contain private repository details.

Required config:

- `privateRepo`: GitHub repo slug, such as `OWNER/PRIVATE_DEPLOYMENT_REPO`.
- `baseBranch`: Private repo branch to compare and target with the PR.
- `branchPrefix`: Prefix for generated PR branches.
- `files`: Allowed Firebase infrastructure files to sync.

The file list is also hardcoded by the CLI as a safety allowlist:

- `.firebaserc`
- `firebase.json`
- `firestore.indexes.json`
- `firestore.rules`

The gitignored local config can choose a subset of those files, but it cannot add new syncable paths on its own. To sync another file, update the committed CLI allowlist, this example/documentation, and the tests so the new path is reviewed before anyone can push it to the private repo.

## Usage

```bash
npm run infra:sync
```

The tool uses the GitHub CLI for authentication. Run `gh auth login` first if needed.

If a local public-checkout file exists and the private repo does not have it, the PR will add that file to the private repo. If the private repo has an allowed file that is missing locally, the tool asks before treating that missing local file as a deletion.
