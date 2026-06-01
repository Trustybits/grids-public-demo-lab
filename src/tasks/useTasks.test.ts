import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

vi.mock('./taskService', () => ({
  subscribeToTasks: vi.fn(),
}))

import { subscribeToTasks } from './taskService'
import { useTasks } from './useTasks'
import type { Task } from './types'

function task(id: string, status: Task['status']): Task {
  return {
    id,
    ownerId: 'owner-1',
    title: `Task ${id}`,
    notes: '',
    dueDate: null,
    status,
    createdAt: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useTasks', () => {
  it('starts in a loading state and does not subscribe without an owner', () => {
    const { result } = renderHook(() => useTasks(undefined))

    expect(result.current.loading).toBe(true)
    expect(result.current.active).toEqual([])
    expect(result.current.completed).toEqual([])
    expect(subscribeToTasks).not.toHaveBeenCalled()
  })

  it('splits emitted tasks into active and completed buckets', () => {
    let emit: (tasks: Task[]) => void = () => {}
    vi.mocked(subscribeToTasks).mockImplementation((_ownerId, onChange) => {
      emit = onChange
      return vi.fn()
    })

    const { result } = renderHook(() => useTasks('owner-1'))
    expect(subscribeToTasks).toHaveBeenCalledWith('owner-1', expect.any(Function))

    act(() => {
      emit([task('1', 'active'), task('2', 'completed'), task('3', 'active')])
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.active.map((t) => t.id)).toEqual(['1', '3'])
    expect(result.current.completed.map((t) => t.id)).toEqual(['2'])
  })

  it('unsubscribes on unmount', () => {
    const unsubscribe = vi.fn()
    vi.mocked(subscribeToTasks).mockReturnValue(unsubscribe)

    const { unmount } = renderHook(() => useTasks('owner-1'))
    unmount()

    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('re-subscribes when the owner changes', () => {
    const unsubscribe = vi.fn()
    vi.mocked(subscribeToTasks).mockReturnValue(unsubscribe)

    const { rerender } = renderHook(({ owner }) => useTasks(owner), {
      initialProps: { owner: 'owner-1' },
    })
    rerender({ owner: 'owner-2' })

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(subscribeToTasks).toHaveBeenLastCalledWith(
      'owner-2',
      expect.any(Function),
    )
  })
})
