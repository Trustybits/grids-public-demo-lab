import { useEffect, useMemo, useState } from 'react'
import { subscribeToTasks } from './taskService'
import type { Task } from './types'

/**
 * Live view of a user's tasks, split into active and completed buckets.
 */
export function useTasks(ownerId: string | undefined) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loadedOwnerId, setLoadedOwnerId] = useState<string | undefined>()

  useEffect(() => {
    if (!ownerId) return
    const unsubscribe = subscribeToTasks(ownerId, (next) => {
      setTasks(next)
      setLoadedOwnerId(ownerId)
    })
    return unsubscribe
  }, [ownerId])

  const loading = ownerId ? loadedOwnerId !== ownerId : true

  const { active, completed } = useMemo(() => {
    return {
      active: tasks.filter((t) => t.status === 'active'),
      completed: tasks.filter((t) => t.status === 'completed'),
    }
  }, [tasks])

  return { active, completed, loading }
}
