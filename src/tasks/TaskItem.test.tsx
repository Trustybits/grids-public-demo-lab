import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./taskService', () => ({
  setTaskStatus: vi.fn(async () => undefined),
  updateTask: vi.fn(async () => undefined),
  deleteTask: vi.fn(async () => undefined),
}))

import { setTaskStatus, updateTask, deleteTask } from './taskService'
import { TaskItem } from './TaskItem'
import type { Task } from './types'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    ownerId: 'owner-1',
    title: 'Write tests',
    notes: 'cover the happy path',
    dueDate: null,
    status: 'active',
    createdAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TaskItem', () => {
  it('renders the title, notes, and a formatted due date', () => {
    render(<TaskItem task={makeTask({ dueDate: '2026-06-10' })} />)

    expect(screen.getByText('Write tests')).toBeInTheDocument()
    expect(screen.getByText('cover the happy path')).toBeInTheDocument()
    // The YYYY-MM-DD string is reformatted into a readable local date.
    expect(screen.getByText(/Due .*2026/)).toBeInTheDocument()
  })

  it('toggles an active task to completed via the checkbox', async () => {
    const user = userEvent.setup()
    render(<TaskItem task={makeTask({ status: 'active' })} />)

    await user.click(screen.getByRole('checkbox', { name: 'Mark completed' }))

    expect(setTaskStatus).toHaveBeenCalledWith('task-1', 'completed')
  })

  it('toggles a completed task back to active', async () => {
    const user = userEvent.setup()
    render(<TaskItem task={makeTask({ status: 'completed' })} />)

    await user.click(screen.getByRole('checkbox', { name: 'Mark active' }))

    expect(setTaskStatus).toHaveBeenCalledWith('task-1', 'active')
  })

  it('saves edits with trimmed values', async () => {
    const user = userEvent.setup()
    render(<TaskItem task={makeTask()} />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))

    const titleInput = screen.getByPlaceholderText('Task title')
    await user.clear(titleInput)
    await user.type(titleInput, '  Updated title  ')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(updateTask).toHaveBeenCalledWith('task-1', {
      title: 'Updated title',
      notes: 'cover the happy path',
      dueDate: null,
    })
  })

  it('does not save when the title is blank', async () => {
    const user = userEvent.setup()
    render(<TaskItem task={makeTask()} />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.clear(screen.getByPlaceholderText('Task title'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(updateTask).not.toHaveBeenCalled()
  })

  it('does not expose an Edit button for completed tasks', () => {
    render(<TaskItem task={makeTask({ status: 'completed' })} />)

    expect(
      screen.queryByRole('button', { name: 'Edit' }),
    ).not.toBeInTheDocument()
  })

  it('deletes the task', async () => {
    const user = userEvent.setup()
    render(<TaskItem task={makeTask()} />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(deleteTask).toHaveBeenCalledWith('task-1')
  })
})
