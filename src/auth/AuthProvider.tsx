import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
} from 'firebase/auth'
import type { User } from 'firebase/auth'
import { auth } from '../firebase'

interface AuthContextValue {
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    return onAuthStateChanged(auth, (next) => {
      setUser(next)
      setLoading(false)
    })
  }, [])

  const value: AuthContextValue = {
    user,
    loading,
    signIn: async (email, password) => {
      await signInWithEmailAndPassword(auth, email, password)
    },
    signUp: async (email, password) => {
      await createUserWithEmailAndPassword(auth, email, password)
    },
    signOut: async () => {
      await fbSignOut(auth)
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
