import { useAuth } from './auth/AuthProvider'
import { LoginPage } from './auth/LoginPage'
import { TasksPage } from './tasks/TasksPage'

function App() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="center-screen">
        <p className="muted">Loading…</p>
      </div>
    )
  }

  return user ? <TasksPage /> : <LoginPage />
}

export default App
