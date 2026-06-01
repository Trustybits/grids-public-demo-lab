import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stand-in sentinels returned by the mocked Firestore helpers so we can assert
// exactly what gets threaded through to addDoc/updateDoc/etc.
const SERVER_TIMESTAMP = Symbol('serverTimestamp')

vi.mock('../firebase', () => ({
  db: { __mockDb: true },
}))

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, path) => ({ __collection: path })),
  doc: vi.fn((_db, path, id) => ({ __doc: `${path}/${id}` })),
  query: vi.fn((...args) => ({ __query: args })),
  where: vi.fn((field, op, value) => ({ __where: [field, op, value] })),
  orderBy: vi.fn((field, dir) => ({ __orderBy: [field, dir] })),
  onSnapshot: vi.fn(),
  addDoc: vi.fn(async () => ({ id: 'new-id' })),
  updateDoc: vi.fn(async () => undefined),
  deleteDoc: vi.fn(async () => undefined),
  serverTimestamp: vi.fn(() => SERVER_TIMESTAMP),
}))

import {
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
} from 'firebase/firestore'
import {
  subscribeToTasks,
  createTask,
  updateTask,
  setTaskStatus,
  deleteTask,
} from './taskService'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('subscribeToTasks', () => {
  it('queries the owner scope, ordered newest first', () => {
    vi.mocked(onSnapshot).mockReturnValue(vi.fn())

    subscribeToTasks('owner-1', () => {})

    expect(where).toHaveBeenCalledWith('ownerId', '==', 'owner-1')
    expect(orderBy).toHaveBeenCalledWith('createdAt', 'desc')
    expect(query).toHaveBeenCalled()
    expect(onSnapshot).toHaveBeenCalled()
  })

  it('maps snapshot docs into Task objects with their id', () => {
    let snapshotHandler: (snap: unknown) => void = () => {}
    vi.mocked(onSnapshot).mockImplementation((_q, handler) => {
      snapshotHandler = handler as (snap: unknown) => void
      return vi.fn()
    })

    const received: unknown[] = []
    subscribeToTasks('owner-1', (tasks) => received.push(tasks))

    snapshotHandler({
      docs: [
        { id: 'a', data: () => ({ ownerId: 'owner-1', title: 'First' }) },
        { id: 'b', data: () => ({ ownerId: 'owner-1', title: 'Second' }) },
      ],
    })

    expect(received[0]).toEqual([
      { id: 'a', ownerId: 'owner-1', title: 'First' },
      { id: 'b', ownerId: 'owner-1', title: 'Second' },
    ])
  })

  it('returns the unsubscribe function from onSnapshot', () => {
    const unsub = vi.fn()
    vi.mocked(onSnapshot).mockReturnValue(unsub)

    expect(subscribeToTasks('owner-1', () => {})).toBe(unsub)
  })
})

describe('createTask', () => {
  it('writes a new active task with a server timestamp', async () => {
    await createTask('owner-1', 'Buy milk', 'two cartons', '2026-06-10')

    // The collection is bound once at module load; assert addDoc receives it.
    expect(addDoc).toHaveBeenCalledWith(
      { __collection: 'tasks' },
      {
        ownerId: 'owner-1',
        title: 'Buy milk',
        notes: 'two cartons',
        dueDate: '2026-06-10',
        status: 'active',
        createdAt: SERVER_TIMESTAMP,
      },
    )
  })

  it('defaults the due date to null', async () => {
    await createTask('owner-1', 'No due date', '')

    expect(addDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ dueDate: null }),
    )
  })
})

describe('updateTask', () => {
  it('targets the right doc and forwards the changes', async () => {
    await updateTask('task-42', { title: 'Renamed', dueDate: null })

    expect(doc).toHaveBeenCalledWith({ __mockDb: true }, 'tasks', 'task-42')
    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'tasks/task-42' },
      { title: 'Renamed', dueDate: null },
    )
  })
})

describe('setTaskStatus', () => {
  it('updates only the status field', async () => {
    await setTaskStatus('task-42', 'completed')

    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'tasks/task-42' },
      { status: 'completed' },
    )
  })
})

describe('deleteTask', () => {
  it('deletes the targeted doc', async () => {
    await deleteTask('task-42')

    expect(doc).toHaveBeenCalledWith({ __mockDb: true }, 'tasks', 'task-42')
    expect(deleteDoc).toHaveBeenCalledWith({ __doc: 'tasks/task-42' })
  })
})
