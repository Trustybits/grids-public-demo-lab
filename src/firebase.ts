import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'

// This is a demo / emulator-only project. The project ID uses the `demo-`
// prefix, which tells the Firebase SDK and CLI to treat it as a demo project:
// it never talks to a real backend, so the config below can use throwaway
// values. All reads/writes go to the local emulator suite (see firebase.json).
const firebaseConfig = {
  apiKey: 'demo-api-key',
  authDomain: 'demo-grids-open-source.firebaseapp.com',
  projectId: 'demo-grids-open-source',
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)

// Point the SDK at the local emulators. Ports must match firebase.json.
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)
