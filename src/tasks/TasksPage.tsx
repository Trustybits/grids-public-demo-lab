import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useTasks } from './useTasks'
import { createTask } from './taskService'
import { TaskItem } from './TaskItem'

export function TasksPage() {
  const { user, signOut } = useAuth()
  const { active, completed, loading } = useTasks(user?.uid)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [dueDate, setDueDate] = useState('')

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed || !user) return
    await createTask(user.uid, trimmed, notes.trim(), dueDate || null)
    setTitle('')
    setNotes('')
    setDueDate('')
  }

  return (
    <div className="tasks-page">
      <header className="topbar">
        <div>
          <h1>Task Tracker</h1>
          <span className="user-email">{user?.email}</span>
        </div>
        <button type="button" className="secondary" onClick={() => signOut()}>
          Sign out
        </button>
      </header>

      <form className="add-task" onSubmit={handleAdd}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          aria-label="Task title"
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          aria-label="Task notes"
        />
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          aria-label="Due date"
        />
        <button type="submit">Add task</button>
      </form>

      {loading ? (
        <p className="muted">Loading tasks…</p>
      ) : (
        <>
          <section>
            <h2>
              Active <span className="count">{active.length}</span>
            </h2>
            {active.length === 0 ? (
              <p className="muted">No active tasks. Add one above.</p>
            ) : (
              <ul className="task-list">
                {active.map((task) => (
                  <TaskItem key={task.id} task={task} />
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2>
              Completed <span className="count">{completed.length}</span>
            </h2>
            {completed.length === 0 ? (
              <p className="muted">Nothing completed yet.</p>
            ) : (
              <ul className="task-list">
                {completed.map((task) => (
                  <TaskItem key={task.id} task={task} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
