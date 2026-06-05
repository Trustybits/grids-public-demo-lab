#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const CONFIG_PATH = path.join(SCRIPT_DIR, "infra-sync.config.json");
const CONFIG_EXAMPLE_PATH = path.join(
  SCRIPT_DIR,
  "infra-sync.config.example.json",
);
const ALLOWED_FILES = [
  ".firebaserc",
  "firebase.json",
  "firestore.indexes.json",
  "firestore.rules",
  "infrastructure.yes",
];

main().catch((error) => {
  console.error("");
  console.error("Infrastructure sync failed.");
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  if (!(await pathExists(CONFIG_PATH))) {
    warnMissingConfig();
    return;
  }

  const config = await loadConfig();
  await assertCommandAvailable("gh", [
    "GitHub CLI is required for private repo access.",
    "Install gh, run `gh auth login`, then rerun `npm run infra:sync`.",
  ]);
  await assertGitHubAuth();

  const tempRoot = await mkdtemp(path.join(tmpdir(), "infra-sync-"));

  try {
    const privateCheckout = path.join(tempRoot, "private-repo");
    await clonePrivateRepo(config, privateCheckout);

    const changes = await collectChanges(config.files, privateCheckout);
    if (changes.length === 0) {
      console.log("No infrastructure differences found.");
      return;
    }

    console.log("Infrastructure differences found:");
    console.log("");
    console.log(changes.map((change) => change.diff).join("\n"));

    const changesToApply = await confirmPrivateOnlyDeletions(changes);
    if (changesToApply.length === 0) {
      console.log(
        "No pull request created because no confirmed changes remain.",
      );
      return;
    }

    const shouldCreatePr = await confirm(
      `Create a pull request in ${config.privateRepoSlug}? [y/N] `,
    );

    if (!shouldCreatePr) {
      console.log("No pull request created.");
      return;
    }

    const prUrl = await createPrivateRepoPr(
      config,
      privateCheckout,
      changesToApply,
    );
    console.log("");
    console.log("Infrastructure sync pull request created:");
    console.log(prUrl);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function warnMissingConfig() {
  console.warn("Private infrastructure sync is not configured.");
  console.warn("");
  console.warn(`Expected config: ${relative(CONFIG_PATH)}`);
  console.warn(`Example config:  ${relative(CONFIG_EXAMPLE_PATH)}`);
  console.warn("");
  console.warn(
    "Forks do not need this script unless they are connected to their own private deployment repo.",
  );
  console.warn(
    "To enable it, copy the example config, add the private repo, run `gh auth login`, then rerun `npm run infra:sync`.",
  );
}

async function loadConfig() {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not parse ${relative(CONFIG_PATH)}: ${error.message}`,
    );
  }

  if (!isNonEmptyString(parsed.privateRepo)) {
    throw new Error("Config must include a non-empty `privateRepo` value.");
  }

  const privateRepoSlug = normalizeGitHubRepo(parsed.privateRepo);
  const baseBranch = isNonEmptyString(parsed.baseBranch)
    ? parsed.baseBranch
    : "main";
  const branchPrefix = isNonEmptyString(parsed.branchPrefix)
    ? parsed.branchPrefix
    : "infra-sync/";
  const files = Array.isArray(parsed.files) ? parsed.files : ALLOWED_FILES;

  validateSafeBranchName(baseBranch, "baseBranch");
  validateSafeBranchPrefix(branchPrefix);
  validateFiles(files);

  return {
    privateRepo: parsed.privateRepo,
    privateRepoSlug,
    baseBranch,
    branchPrefix,
    files,
  };
}

function validateFiles(files) {
  if (files.length === 0) {
    throw new Error("Config must include at least one file to sync.");
  }

  const allowed = new Set(ALLOWED_FILES);
  const seen = new Set();

  for (const file of files) {
    if (!isNonEmptyString(file)) {
      throw new Error("Config `files` entries must be non-empty strings.");
    }

    if (
      path.isAbsolute(file) ||
      file.includes("..") ||
      path.normalize(file) !== file
    ) {
      throw new Error(`Unsafe file path in config: ${file}`);
    }

    if (!allowed.has(file)) {
      throw new Error(
        `File is not allowed for infrastructure sync: ${file}. Allowed files: ${ALLOWED_FILES.join(", ")}`,
      );
    }

    if (seen.has(file)) {
      throw new Error(`Duplicate file in config: ${file}`);
    }

    seen.add(file);
  }
}

async function assertCommandAvailable(command, messageLines) {
  const result = await run(command, ["--version"], { allowFailure: true });
  if (result.errorCode === "ENOENT") {
    throw new Error(messageLines.join("\n"));
  }
}

async function assertGitHubAuth() {
  const result = await run(
    "gh",
    ["auth", "status", "--hostname", "github.com"],
    {
      allowFailure: true,
    },
  );

  if (result.status !== 0) {
    throw new Error(
      [
        "GitHub CLI is not authenticated for github.com.",
        "Run `gh auth login`, make sure the account has access to the private repo, then rerun `npm run infra:sync`.",
      ].join("\n"),
    );
  }
}

async function clonePrivateRepo(config, privateCheckout) {
  console.log(`Checking ${config.privateRepoSlug} ${config.baseBranch}...`);
  const result = await run(
    "gh",
    [
      "repo",
      "clone",
      config.privateRepoSlug,
      privateCheckout,
      "--",
      "--branch",
      config.baseBranch,
      "--depth",
      "1",
    ],
    { allowFailure: true },
  );

  if (result.status !== 0) {
    throw new Error(
      [
        `Could not clone private repo ${config.privateRepoSlug}.`,
        "Confirm the repo exists and your `gh` account has access.",
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

async function collectChanges(files, privateCheckout) {
  const changes = [];

  for (const file of files) {
    const publicPath = path.join(REPO_ROOT, file);
    const privatePath = path.join(privateCheckout, file);

    await assertNoSymlink(publicPath);
    await assertNoSymlink(privatePath);

    const [publicContent, privateContent] = await Promise.all([
      readOptionalFile(publicPath),
      readOptionalFile(privatePath),
    ]);

    if (buffersEqual(publicContent, privateContent)) {
      continue;
    }

    const diff = await diffFile(file, privatePath, publicPath);
    changes.push({
      file,
      publicPath,
      privatePath,
      publicExists: publicContent !== null,
      privateExists: privateContent !== null,
      diff,
    });
  }

  return changes;
}

async function diffFile(file, privatePath, publicPath) {
  const privateExists = await pathExists(privatePath);
  const publicExists = await pathExists(publicPath);
  const oldPath = privateExists ? privatePath : "/dev/null";
  const newPath = publicExists ? publicPath : "/dev/null";
  const result = await run(
    "git",
    ["diff", "--no-index", "--no-ext-diff", oldPath, newPath],
    { allowFailure: true },
  );

  if (result.status !== 0 && result.status !== 1) {
    throw new Error(
      `Could not generate diff for ${file}: ${result.stderr.trim()}`,
    );
  }

  return result.stdout.trimEnd();
}

async function confirmPrivateOnlyDeletions(changes) {
  const privateOnlyChanges = changes.filter(
    (change) => !change.publicExists && change.privateExists,
  );

  if (privateOnlyChanges.length === 0) {
    return changes;
  }

  console.log("");
  console.log(
    "You do not have local files of the following private infrastructure files:",
  );
  for (const change of privateOnlyChanges) {
    console.log(`- ${change.file}`);
  }
  console.log("");

  const shouldRemovePrivateFiles = await confirm(
    "Do you want to remove those files in the private repo? <y/N> ",
  );

  if (shouldRemovePrivateFiles) {
    return changes;
  }

  const privateOnlyFiles = new Set(
    privateOnlyChanges.map((change) => change.file),
  );
  return changes.filter((change) => !privateOnlyFiles.has(change.file));
}

async function createPrivateRepoPr(config, privateCheckout, changes) {
  const branchName = `${config.branchPrefix}${timestamp()}`;
  validateSafeBranchName(branchName, "generated branch name");

  try {
    await assertCleanCheckout(privateCheckout);
    await runChecked("git", ["switch", "-c", branchName], {
      cwd: privateCheckout,
    });

    for (const change of changes) {
      if (change.publicExists) {
        await mkdir(path.dirname(change.privatePath), { recursive: true });
        await writeFile(change.privatePath, await readFile(change.publicPath));
      } else {
        await unlink(change.privatePath).catch((error) => {
          if (error.code !== "ENOENT") {
            throw error;
          }
        });
      }
    }

    await runChecked(
      "git",
      ["add", "--", ...changes.map((change) => change.file)],
      {
        cwd: privateCheckout,
      },
    );

    const status = await runChecked(
      "git",
      ["status", "--porcelain", "--", ...changes.map((change) => change.file)],
      { cwd: privateCheckout },
    );

    if (status.stdout.trim() === "") {
      throw new Error(
        "No private repo changes remained after applying the sync.",
      );
    }

    await runChecked(
      "git",
      ["commit", "-m", "Sync infrastructure files from public checkout"],
      { cwd: privateCheckout },
    );
    await runChecked("git", ["push", "origin", `HEAD:${branchName}`], {
      cwd: privateCheckout,
    });

    const publicContext = await getPublicContext();
    const prBody = [
      "Syncs local infrastructure files from the public checkout.",
      "",
      `Runner: ${await getGitHubLogin()}`,
      `Public repo: ${publicContext.remote}`,
      `Public branch: ${publicContext.branch}`,
      `Public commit: ${publicContext.commit}`,
      "",
      "Changed files:",
      ...changes.map((change) => `- ${change.file}`),
      "",
      "Review these infrastructure files carefully before merging.",
    ].join("\n");

    const pr = await runChecked("gh", [
      "pr",
      "create",
      "--repo",
      config.privateRepoSlug,
      "--base",
      config.baseBranch,
      "--head",
      branchName,
      "--title",
      "Sync infrastructure files",
      "--body",
      prBody,
    ]);

    return pr.stdout.trim();
  } catch (error) {
    throw new Error(
      [
        "Pull request creation did not complete.",
        error.message,
        `If a branch was pushed, check ${config.privateRepoSlug} for ${branchName}.`,
      ].join("\n"),
    );
  }
}

async function assertCleanCheckout(checkoutPath) {
  const status = await runChecked("git", ["status", "--porcelain"], {
    cwd: checkoutPath,
  });

  if (status.stdout.trim() !== "") {
    throw new Error("Private checkout has unexpected changes before sync.");
  }
}

async function getPublicContext() {
  const [branch, commit, remote] = await Promise.all([
    run("git", ["branch", "--show-current"], {
      cwd: REPO_ROOT,
      allowFailure: true,
    }),
    run("git", ["rev-parse", "--short", "HEAD"], {
      cwd: REPO_ROOT,
      allowFailure: true,
    }),
    run("git", ["remote", "get-url", "origin"], {
      cwd: REPO_ROOT,
      allowFailure: true,
    }),
  ]);

  return {
    branch: branch.stdout.trim() || "unknown",
    commit: commit.stdout.trim() || "unknown",
    remote: remote.stdout.trim() || "unknown",
  };
}

async function getGitHubLogin() {
  const result = await run("gh", ["api", "user", "--jq", ".login"], {
    allowFailure: true,
  });

  return result.stdout.trim() || "unknown";
}

async function confirm(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(question);
    return (
      answer.trim().toLowerCase() === "y" ||
      answer.trim().toLowerCase() === "yes"
    );
  } finally {
    rl.close();
  }
}

function normalizeGitHubRepo(repo) {
  const trimmed = repo.trim();

  const slugMatch = trimmed.match(
    /^(?:(?<host>[A-Za-z0-9.-]+)\/)?(?<owner>[A-Za-z0-9_.-]+)\/(?<name>[A-Za-z0-9_.-]+)$/,
  );
  if (slugMatch?.groups) {
    return [
      slugMatch.groups.host,
      slugMatch.groups.owner,
      slugMatch.groups.name.replace(/\.git$/, ""),
    ]
      .filter(Boolean)
      .join("/");
  }

  const httpsMatch = trimmed.match(
    /^https:\/\/(?<host>[^/]+)\/(?<owner>[^/]+)\/(?<name>[^/]+?)(?:\.git)?\/?$/,
  );
  if (httpsMatch?.groups) {
    return [
      httpsMatch.groups.host === "github.com"
        ? undefined
        : httpsMatch.groups.host,
      httpsMatch.groups.owner,
      httpsMatch.groups.name,
    ]
      .filter(Boolean)
      .join("/");
  }

  const sshMatch = trimmed.match(
    /^git@(?<host>[^:]+):(?<owner>[^/]+)\/(?<name>.+?)(?:\.git)?$/,
  );
  if (sshMatch?.groups) {
    return [
      sshMatch.groups.host === "github.com" ? undefined : sshMatch.groups.host,
      sshMatch.groups.owner,
      sshMatch.groups.name,
    ]
      .filter(Boolean)
      .join("/");
  }

  throw new Error(
    "`privateRepo` must be a GitHub repo slug like OWNER/REPO, an HTTPS URL, or an SSH URL.",
  );
}

function validateSafeBranchName(value, label) {
  if (
    !/^[A-Za-z0-9._/-]+$/.test(value) ||
    value.includes("..") ||
    value.endsWith("/")
  ) {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
}

function validateSafeBranchPrefix(value) {
  if (!/^[A-Za-z0-9._/-]+$/.test(value) || value.includes("..")) {
    throw new Error(`Unsafe branchPrefix: ${value}`);
  }
}

async function assertNoSymlink(filePath) {
  const stats = await lstat(filePath).catch((error) => {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  });

  if (stats?.isSymbolicLink()) {
    throw new Error(
      `Refusing to read symlinked infrastructure file: ${relative(filePath)}`,
    );
  }
}

async function readOptionalFile(filePath) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function buffersEqual(left, right) {
  if (left === null || right === null) {
    return left === right;
  }

  return left.equals(right);
}

async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function relative(filePath) {
  return path.relative(REPO_ROOT, filePath);
}

async function runChecked(command, args, options = {}) {
  const result = await run(command, args, options);
  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(" ")} failed with exit code ${result.status}.`,
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return result;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (options.allowFailure) {
        resolve({
          status: 127,
          stdout,
          stderr,
          errorCode: error.code,
        });
        return;
      }

      reject(error);
    });
    child.on("close", (status) => {
      resolve({
        status,
        stdout,
        stderr,
      });
    });
  });
}
