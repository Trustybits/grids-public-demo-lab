import type { Timestamp } from 'firebase/firestore'

export type TaskStatus = 'active' | 'completed'

export interface Task {
  id: string
  ownerId: string
  title: string
  notes: string
  dueDate: string | null
  status: TaskStatus
  createdAt: Timestamp | null
}
