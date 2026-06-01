#!/usr/bin/env node
// Bumps the version in package.json AND package-lock.json: patch += 1 each run,
// but once the patch would reach 25 the minor is bumped and the patch resets to 0.
//
// We patch only the version fields textually rather than running `npm install`.
// `npm install` re-resolves the dependency tree and prunes/adds platform-specific
// optional deps (e.g. the @emnapi/* WASM-fallback packages), which produces large,
// meaningless lockfile diffs that differ per OS. A version-only bump changes
// nothing about the dependency graph, so touching only the version fields keeps
// the lockfile stable and cross-platform consistent.
//
// Prints the new version to stdout (and nothing else) so the workflow can capture it.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const pkgUrl = new URL('../package.json', import.meta.url)
const pkgContent = readFileSync(pkgUrl, 'utf8')

const match = pkgContent.match(/"version":\s*"(\d+)\.(\d+)\.(\d+)"/)
if (!match) {
  console.error('Could not find a semver "version" field in package.json')
  process.exit(1)
}

const major = Number(match[1])
let minor = Number(match[2])
let patch = Number(match[3]) + 1

if (patch >= 25) {
  minor += 1
  patch = 0
}

const oldVersion = `${match[1]}.${match[2]}.${match[3]}`
const newVersion = `${major}.${minor}.${patch}`

// Update package.json — replace only the version field.
writeFileSync(pkgUrl, pkgContent.replace(match[0], `"version": "${newVersion}"`))

// Update package-lock.json — the version appears in exactly two places at the
// top: the root "version" and packages."".version. Those are always the first
// two "version" lines in the file (dependency entries come afterwards), so
// replace the first two occurrences of the old version and leave the rest alone.
const lockUrl = new URL('../package-lock.json', import.meta.url)
if (existsSync(lockUrl)) {
  const lockContent = readFileSync(lockUrl, 'utf8')
  const escapedOld = oldVersion.replace(/\./g, '\\.')
  let replaced = 0
  const updatedLock = lockContent.replace(
    new RegExp(`"version": "${escapedOld}"`, 'g'),
    (m) => (replaced++ < 2 ? `"version": "${newVersion}"` : m),
  )
  if (replaced < 2) {
    console.error(
      `Warning: expected to patch 2 version fields in package-lock.json, patched ${replaced}. ` +
        'Is the lockfile version in sync with package.json?',
    )
  }
  writeFileSync(lockUrl, updatedLock)
}

process.stdout.write(newVersion)
