import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from './AuthProvider'

export function LoginPage() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'signIn') {
        await signIn(email, password)
      } else {
        await signUp(email, password)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-card">
      <h1>Task Tracker</h1>
      <p className="subtitle">
        {mode === 'signIn' ? 'Sign in to your account' : 'Create an account'}
      </p>

      <form onSubmit={handleSubmit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
            minLength={6}
            required
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signIn' ? 'Sign in' : 'Sign up'}
        </button>
      </form>

      <button
        type="button"
        className="link"
        onClick={() => {
          setMode(mode === 'signIn' ? 'signUp' : 'signIn')
          setError(null)
        }}
      >
        {mode === 'signIn'
          ? "Don't have an account? Sign up"
          : 'Already have an account? Sign in'}
      </button>

      <p className="hint">
        Running against the Firebase Auth emulator — use any email/password
        (min 6 chars). Sign up first to create a demo user.
      </p>
    </div>
  )
}
