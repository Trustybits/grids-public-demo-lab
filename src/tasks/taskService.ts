import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import type { Task, TaskStatus } from './types'

const tasksCollection = collection(db, 'tasks')

/**
 * Subscribe to the current user's tasks, newest first. Returns an
 * unsubscribe function. Tasks are scoped to the owner so each demo user
 * only sees their own list.
 */
export function subscribeToTasks(
  ownerId: string,
  onChange: (tasks: Task[]) => void,
) {
  const q = query(
    tasksCollection,
    where('ownerId', '==', ownerId),
    orderBy('createdAt', 'desc'),
  )

  return onSnapshot(q, (snapshot) => {
    const tasks = snapshot.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<Task, 'id'>),
    }))
    onChange(tasks)
  })
}

export async function createTask(
  ownerId: string,
  title: string,
  notes: string,
  dueDate: string | null = null,
) {
  await addDoc(tasksCollection, {
    ownerId,
    title,
    notes,
    dueDate,
    status: 'active' satisfies TaskStatus,
    createdAt: serverTimestamp(),
  })
}

export async function updateTask(
  id: string,
  changes: Partial<Pick<Task, 'title' | 'notes' | 'dueDate' | 'status'>>,
) {
  await updateDoc(doc(db, 'tasks', id), changes)
}

export async function setTaskStatus(id: string, status: TaskStatus) {
  await updateTask(id, { status })
}

export async function deleteTask(id: string) {
  await deleteDoc(doc(db, 'tasks', id))
}
