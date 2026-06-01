import { useEffect, useMemo, useState } from 'react'
import { subscribeToTasks } from './taskService'
import type { Task } from './types'

/**
 * Live view of a user's tasks, split into active and completed buckets.
 */
export function useTasks(ownerId: string | undefined) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ownerId) return
    setLoading(true)
    const unsubscribe = subscribeToTasks(ownerId, (next) => {
      setTasks(next)
      setLoading(false)
    })
    return unsubscribe
  }, [ownerId])

  const { active, completed } = useMemo(() => {
    return {
      active: tasks.filter((t) => t.status === 'active'),
      completed: tasks.filter((t) => t.status === 'completed'),
    }
  }, [tasks])

  return { active, completed, loading }
}
