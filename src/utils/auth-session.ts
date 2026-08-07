import type { AuthSession } from '../api/auth'

const authSessionStorageKey = 'fe-web.auth-session'

function parseSession(value: string | null): AuthSession | null {
  if (!value) {
    return null
  }

  try {
    const session = JSON.parse(value) as AuthSession
    if (!session.accessToken || !session.user?.name) {
      return null
    }
    return session
  } catch {
    return null
  }
}

export function readAuthSession(): AuthSession | null {
  return parseSession(window.localStorage.getItem(authSessionStorageKey)) ?? parseSession(window.sessionStorage.getItem(authSessionStorageKey))
}

export function saveAuthSession(session: AuthSession, remember: boolean) {
  clearAuthSession()
  const storage = remember ? window.localStorage : window.sessionStorage
  storage.setItem(authSessionStorageKey, JSON.stringify(session))
}

export function updateAuthSession(session: AuthSession) {
  const storage = window.localStorage.getItem(authSessionStorageKey) !== null
    ? window.localStorage
    : window.sessionStorage
  storage.setItem(authSessionStorageKey, JSON.stringify(session))
}

export function clearAuthSession() {
  window.localStorage.removeItem(authSessionStorageKey)
  window.sessionStorage.removeItem(authSessionStorageKey)
}
