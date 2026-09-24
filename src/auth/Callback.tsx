import { useEffect, useRef, useState } from 'react'
import { getCurrentUser } from '../api/auth'
import { consumeAuthorizationCallback, exchangeAuthorizationCode } from './oauth'
import type { AuthSession } from './types'
import { beginNavigationActivity } from '../navigation/controller'

type CallbackProps = {
  onAuthenticated: (session: AuthSession, returnTo: string) => void
  onFailure: (message: string) => void
}

export default function Callback({ onAuthenticated, onFailure }: CallbackProps) {
  const started = useRef(false)
  const [message, setMessage] = useState('正在验证统一认证结果...')

  useEffect(() => {
    if (started.current) return
    started.current = true

    async function complete() {
      const finishActivity = beginNavigationActivity()
      try {
        const { code, verifier, returnTo } = await consumeAuthorizationCallback(window.location.search)
        setMessage('正在建立作业服务会话...')
        const token = await exchangeAuthorizationCode(code, verifier)
        let user = null
        try {
          user = await getCurrentUser(token.access_token)
        } catch (e) {
          console.warn('Failed to load user profile during callback:', e)
        }
        finishActivity()
        onAuthenticated({
          accessToken: token.access_token,
          tokenType: token.token_type,
          expiresAt: Date.now() + token.expires_in * 1000,
          scope: token.scope,
          refreshToken: token.refresh_token,
          user,
        }, returnTo)
      } catch (error) {
        finishActivity()
        onFailure(error instanceof Error ? error.message : '认证失败，请重新登录')
      }
    }

    void complete()
  }, [onAuthenticated, onFailure])

  return <main className="auth-callback"><p>{message}</p></main>
}
