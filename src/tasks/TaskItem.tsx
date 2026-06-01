import { useState } from 'react'
import { setTaskStatus, updateTask, deleteTask } from './taskService'
import type { Task } from './types'

export function TaskItem({ task }: { task: Task }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes)

  const isCompleted = task.status === 'completed'

  async function handleSave() {
    const trimmed = title.trim()
    if (!trimmed) return
    await updateTask(task.id, { title: trimmed, notes: notes.trim() })
    setEditing(false)
  }

  if (editing) {
    return (
      <li className="task editing">
        <div className="task-edit">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            rows={2}
          />
          <div className="task-actions">
            <button type="button" onClick={handleSave}>
              Save
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setTitle(task.title)
                setNotes(task.notes)
                setEditing(false)
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </li>
    )
  }

  return (
    <li className={`task ${isCompleted ? 'completed' : ''}`}>
      <input
        type="checkbox"
        checked={isCompleted}
        onChange={() =>
          setTaskStatus(task.id, isCompleted ? 'active' : 'completed')
        }
        aria-label={isCompleted ? 'Mark active' : 'Mark completed'}
      />
      <div className="task-body">
        <span className="task-title">{task.title}</span>
        {task.notes && <span className="task-notes">{task.notes}</span>}
      </div>
      <div className="task-actions">
        {!isCompleted && (
          <button
            type="button"
            className="secondary"
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
        )}
        <button
          type="button"
          className="danger"
          onClick={() => deleteTask(task.id)}
        >
          Delete
        </button>
      </div>
    </li>
  )
}
