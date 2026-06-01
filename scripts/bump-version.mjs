#!/usr/bin/env node
// Bumps the version in package.json: patch += 1 each run, but once the patch
// would reach 25 the minor is bumped and the patch resets to 0.
// Prints the new version to stdout so the workflow can capture it.
import { readFileSync, writeFileSync } from 'node:fs'

const pkgPath = new URL('../package.json', import.meta.url)
const content = readFileSync(pkgPath, 'utf8')

const match = content.match(/"version":\s*"(\d+)\.(\d+)\.(\d+)"/)
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

const newVersion = `${major}.${minor}.${patch}`

// Replace only the version field so the rest of package.json stays byte-identical.
const updated = content.replace(match[0], `"version": "${newVersion}"`)
writeFileSync(pkgPath, updated)

process.stdout.write(newVersion)
