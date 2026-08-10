import { oauthConfig, oauthTransactionMaxAgeMs, oauthTransactionStorageKey } from './config'
import { createCodeChallenge, createRandomValue } from './pkce'
import type { OAuthTokenResponse, OAuthTransaction } from './types'
import { beginNavigationActivity, transitionTo } from '../navigation/controller'

export function normalizeReturnTo(value: string | null | undefined) {
  if (value === '/' || value === '/history' || value === '/settings') return value
  return '/'
}

function isValidReturnTo(value: unknown): value is '/' | '/history' | '/settings' {
  return value === '/' || value === '/history' || value === '/settings'
}

function readTransaction(): OAuthTransaction | null {
  const raw = window.sessionStorage.getItem(oauthTransactionStorageKey)
  if (!raw) return null

  try {
    const transaction = JSON.parse(raw) as OAuthTransaction
    if (
      !transaction.state
      || !transaction.verifier
      || typeof transaction.createdAt !== 'number'
      || !isValidReturnTo(transaction.returnTo)
    ) {
      return null
    }
    return transaction
  } catch {
    return null
  }
}

export async function startAuthorization(returnTo: string) {
  const finishActivity = beginNavigationActivity()
  try {
    const verifier = createRandomValue(64)
    const state = createRandomValue(32)
    const transaction: OAuthTransaction = {
      state,
      verifier,
      returnTo: normalizeReturnTo(returnTo),
      createdAt: Date.now(),
    }
    const codeChallenge = await createCodeChallenge(verifier)
    window.sessionStorage.setItem(oauthTransactionStorageKey, JSON.stringify(transaction))

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: oauthConfig.clientId,
      redirect_uri: oauthConfig.redirectUri,
      scope: oauthConfig.scope,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })
    transitionTo(`${oauthConfig.authorizeUrl}?${params}`)
  } catch (error) {
    finishActivity()
    throw error
  }
}

export async function consumeAuthorizationCallback(search: string) {
  const params = new URLSearchParams(search)
  const code = params.get('code')
  const state = params.get('state')
  const authorizationError = params.get('error')
  const transaction = readTransaction()

  // Clear one-time callback values before making any network request.
  window.history.replaceState(null, '', '/auth/callback')
  window.sessionStorage.removeItem(oauthTransactionStorageKey)

  if (authorizationError) throw new Error('统一认证未完成，请重新登录')
  if (!code || !state || !transaction) throw new Error('登录状态无效或已过期，请重新登录')
  if (Date.now() - transaction.createdAt > oauthTransactionMaxAgeMs || transaction.createdAt > Date.now()) {
    throw new Error('登录状态已过期，请重新登录')
  }
  if (state !== transaction.state) throw new Error('登录状态校验失败，请重新登录')

  return { code, verifier: transaction.verifier, returnTo: normalizeReturnTo(transaction.returnTo) }
}

export async function exchangeAuthorizationCode(code: string, verifier: string): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: oauthConfig.clientId,
    redirect_uri: oauthConfig.redirectUri,
    code_verifier: verifier,
  })
  let response: Response
  try {
    response = await fetch(oauthConfig.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
  } catch {
    throw new Error('无法连接认证服务，请检查网络后重试')
  }
  if (!response.ok) throw new Error('登录凭据无效或已过期，请重新登录')
  return response.json() as Promise<OAuthTokenResponse>
}
