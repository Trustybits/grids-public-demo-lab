import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const defaultConfig = {
  privateRepo: 'Trustybits/grids-private-demo-lab',
  baseBranch: 'main',
  branchPrefix: 'infra-sync/',
  files: ['firebase.json'],
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  process.exitCode = undefined
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  vi.doUnmock('node:child_process')
  vi.doUnmock('node:fs/promises')
  vi.doUnmock('node:os')
  vi.doUnmock('node:readline/promises')
  process.exitCode = undefined
})

describe('infra-sync CLI', () => {
  it('warns and exits without external commands when local config is missing', async () => {
    const harness = await runInfraSync({ config: undefined })

    expect(harness.spawn).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(
      'Private infrastructure sync is not configured.',
    )
    expect(console.warn).toHaveBeenCalledWith(
      'Forks do not need this script unless they are connected to their own private deployment repo.',
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('rejects config files outside the hardcoded allowlist', async () => {
    await runInfraSync({
      config: {
        ...defaultConfig,
        files: ['firebase.json', 'storage.rules'],
      },
    })

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('File is not allowed for infrastructure sync: storage.rules'),
    )
    expect(process.exitCode).toBe(1)
  })

  it('reports no differences when public and private file contents match', async () => {
    const harness = await runInfraSync({
      files: {
        'public:firebase.json': '{"emulators":{}}\n',
        'private:firebase.json': '{"emulators":{}}\n',
      },
    })

    expect(console.log).toHaveBeenCalledWith('No infrastructure differences found.')
    expect(harness.questions).toEqual([])
    expect(harness.spawn).not.toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['diff']),
      expect.anything(),
    )
  })

  it('adds a public-only file to the private checkout when a PR is approved', async () => {
    const harness = await runInfraSync({
      answers: ['y'],
      files: {
        'public:firebase.json': '{"hosting":{}}\n',
      },
    })

    expect(harness.questions).toEqual([
      'Create a pull request in Trustybits/grids-private-demo-lab? [y/N] ',
    ])
    expect(harness.writeFile).toHaveBeenCalledWith(
      '/tmp/infra-sync-test/private-repo/firebase.json',
      Buffer.from('{"hosting":{}}\n'),
    )
    expect(harness.unlink).not.toHaveBeenCalled()
    expect(harness.spawn).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['pr', 'create']),
      expect.anything(),
    )
    expect(console.log).toHaveBeenCalledWith(
      'https://github.com/Trustybits/grids-private-demo-lab/pull/1',
    )
  })

  it('does not delete private-only files when the deletion prompt is declined', async () => {
    const harness = await runInfraSync({
      answers: ['n'],
      files: {
        'private:firebase.json': '{"private":true}\n',
      },
    })

    expect(console.log).toHaveBeenCalledWith(
      'You do not have local files of the following private infrastructure files:',
    )
    expect(console.log).toHaveBeenCalledWith('- firebase.json')
    expect(harness.questions).toEqual([
      'Do you want to remove those files in the private repo? <y/N> ',
    ])
    expect(harness.unlink).not.toHaveBeenCalled()
    expect(harness.spawn).not.toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['pr', 'create']),
      expect.anything(),
    )
    expect(console.log).toHaveBeenCalledWith(
      'No pull request created because no confirmed changes remain.',
    )
  })

  it('filters declined private-only deletions while still creating a PR for confirmed changes', async () => {
    const harness = await runInfraSync({
      answers: ['n', 'y'],
      config: {
        ...defaultConfig,
        files: ['firebase.json', 'firestore.rules'],
      },
      files: {
        'public:firebase.json': '{"local":true}\n',
        'private:firebase.json': '{"private":true}\n',
        'private:firestore.rules': 'rules_version = "2";\n',
      },
    })

    expect(harness.unlink).not.toHaveBeenCalled()
    expect(harness.writeFile).toHaveBeenCalledWith(
      '/tmp/infra-sync-test/private-repo/firebase.json',
      Buffer.from('{"local":true}\n'),
    )
    expect(harness.spawn).toHaveBeenCalledWith(
      'git',
      ['add', '--', 'firebase.json'],
      expect.objectContaining({ cwd: '/tmp/infra-sync-test/private-repo' }),
    )
    expect(harness.spawn).toHaveBeenCalledWith(
      'gh',
      expect.not.arrayContaining(['firestore.rules']),
      expect.anything(),
    )
  })

  it('deletes private-only files when the deletion prompt and PR prompt are approved', async () => {
    const harness = await runInfraSync({
      answers: ['yes', 'yes'],
      files: {
        'private:firebase.json': '{"private":true}\n',
      },
    })

    expect(harness.unlink).toHaveBeenCalledWith(
      '/tmp/infra-sync-test/private-repo/firebase.json',
    )
    expect(harness.spawn).toHaveBeenCalledWith(
      'git',
      ['add', '--', 'firebase.json'],
      expect.objectContaining({ cwd: '/tmp/infra-sync-test/private-repo' }),
    )
    expect(harness.spawn).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['pr', 'create']),
      expect.anything(),
    )
  })

  it('refuses to read symlinked infrastructure files', async () => {
    await runInfraSync({
      files: {
        'public:firebase.json': '{"local":true}\n',
        'private:firebase.json': '{"private":true}\n',
      },
      symlinks: new Set(['public:firebase.json']),
    })

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Refusing to read symlinked infrastructure file'),
    )
    expect(process.exitCode).toBe(1)
  })
})

async function runInfraSync(options = {}) {
  const state = createHarnessState(options)

  vi.doMock('node:fs/promises', () => {
    const mockedFs = {
      access: state.access,
      lstat: state.lstat,
      mkdir: state.mkdir,
      mkdtemp: state.mkdtemp,
      readFile: state.readFile,
      rm: state.rm,
      unlink: state.unlink,
      writeFile: state.writeFile,
    }

    return {
      ...mockedFs,
      default: mockedFs,
    }
  })

  vi.doMock('node:child_process', () => ({
    spawn: state.spawn,
    default: {
      spawn: state.spawn,
    },
  }))

  vi.doMock('node:os', () => ({
    tmpdir: vi.fn(() => '/tmp'),
    default: {
      tmpdir: vi.fn(() => '/tmp'),
    },
  }))

  vi.doMock('node:readline/promises', () => ({
    default: {
      createInterface: state.createInterface,
    },
  }))

  vi.resetModules()
  await import('./index.mjs')
  await waitForCompletion(state)

  return state
}

function createHarnessState(options) {
  const config =
    Object.hasOwn(options, 'config') ? options.config : defaultConfig
  const files = new Map(Object.entries(options.files ?? {}))
  const symlinks = options.symlinks ?? new Set()
  const questions = []
  const answers = [...(options.answers ?? [])]

  const state = {
    questions,
    config,
    access: vi.fn(async (filePath) => {
      if (hasPath(config, files, filePath)) return undefined
      throw enoent(filePath)
    }),
    lstat: vi.fn(async (filePath) => {
      const key = keyFor(filePath)
      if (!files.has(key)) throw enoent(filePath)
      return {
        isSymbolicLink: () => symlinks.has(key),
      }
    }),
    mkdir: vi.fn(async () => undefined),
    mkdtemp: vi.fn(async () => '/tmp/infra-sync-test'),
    readFile: vi.fn(async (filePath) => {
      if (isConfigPath(filePath)) {
        if (config === undefined) throw enoent(filePath)
        return JSON.stringify(config)
      }

      const key = keyFor(filePath)
      if (!files.has(key)) throw enoent(filePath)
      return Buffer.from(files.get(key))
    }),
    rm: vi.fn(async () => undefined),
    unlink: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    createInterface: vi.fn(() => ({
      question: vi.fn(async (question) => {
        questions.push(question)
        return answers.shift() ?? 'n'
      }),
      close: vi.fn(),
    })),
  }

  state.spawn = vi.fn((command, args, spawnOptions) => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()

    queueMicrotask(() => {
      const result = commandResult(command, args, spawnOptions)
      if (result.errorCode) {
        child.emit('error', Object.assign(new Error(result.errorCode), {
          code: result.errorCode,
        }))
        return
      }

      if (result.stdout) child.stdout.emit('data', result.stdout)
      if (result.stderr) child.stderr.emit('data', result.stderr)
      child.emit('close', result.status ?? 0)
    })

    return child
  })

  return state
}

function commandResult(command, args, spawnOptions) {
  if (command === 'gh' && args[0] === '--version') {
    return { stdout: 'gh version 2.0.0\n' }
  }

  if (command === 'gh' && args[0] === 'auth') {
    return { stdout: 'Logged in to github.com\n' }
  }

  if (command === 'gh' && args[0] === 'repo') {
    return { stdout: 'cloned\n' }
  }

  if (command === 'gh' && args[0] === 'api') {
    return { stdout: 'alice\n' }
  }

  if (command === 'gh' && args[0] === 'pr') {
    return { stdout: 'https://github.com/Trustybits/grids-private-demo-lab/pull/1\n' }
  }

  if (command === 'git' && args[0] === 'diff') {
    const comparedPath = args.at(-1)
    const file = comparedPath === '/dev/null' ? args.at(-2) : comparedPath
    return {
      status: 1,
      stdout: `diff --git a/${keyFor(file)} b/${keyFor(file)}\n`,
    }
  }

  if (command === 'git' && args[0] === 'status') {
    return {
      stdout: args.includes('--') ? ' M firebase.json\n' : '',
    }
  }

  if (command === 'git' && args[0] === 'branch') {
    return { stdout: 'main\n' }
  }

  if (command === 'git' && args[0] === 'rev-parse') {
    return { stdout: 'abc123\n' }
  }

  if (command === 'git' && args[0] === 'remote') {
    return { stdout: 'https://github.com/Trustybits/grids-public-demo-lab.git\n' }
  }

  if (command === 'git' && ['switch', 'add', 'commit', 'push'].includes(args[0])) {
    return { stdout: `${args[0]} ok\n` }
  }

  throw new Error(
    `Unexpected command: ${command} ${args.join(' ')} ${JSON.stringify(spawnOptions)}`,
  )
}

function hasPath(config, files, filePath) {
  if (isConfigPath(filePath)) return config !== undefined
  return files.has(keyFor(filePath))
}

function isConfigPath(filePath) {
  return normalized(filePath).endsWith('/tools/infra-sync/infra-sync.config.json')
}

function keyFor(filePath) {
  const value = normalized(filePath)
  const privateMarker = '/private-repo/'
  const privateIndex = value.indexOf(privateMarker)

  if (privateIndex >= 0) {
    return `private:${value.slice(privateIndex + privateMarker.length)}`
  }

  return `public:${value.slice(value.lastIndexOf('/') + 1)}`
}

function normalized(filePath) {
  return String(filePath).replaceAll('\\', '/')
}

function enoent(filePath) {
  return Object.assign(new Error(`ENOENT: ${filePath}`), { code: 'ENOENT' })
}

async function waitForCompletion(state) {
  for (let index = 0; index < 50; index += 1) {
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))

    if (state.config === undefined && console.warn.mock.calls.length > 0) {
      return
    }

    if (state.rm.mock.calls.length > 0 || process.exitCode === 1) {
      return
    }
  }
}
