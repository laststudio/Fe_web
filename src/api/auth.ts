import { oauthConfig } from '../auth/config'

export type User = {
  id: number
  name: string
  role: number
  member_level: number
  avatar_url?: string | null
}

type ApiErrorBody = {
  detail?: string | { msg?: string }[] | { message?: string }
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type ApiRequestOptions = RequestInit & { accessToken?: string }
let unauthorizedHandler: (() => void) | null = null

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler
}

export async function apiRequest<T>(path: string, { accessToken, ...init }: ApiRequestOptions = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const method = (init.method || 'GET').toUpperCase()
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  if (accessToken && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set('X-Request-Timestamp', String(Math.floor(Date.now() / 1000)))
    headers.set('X-Request-Nonce', crypto.randomUUID())
  }

  let response: Response
  try {
    response = await fetch(`${oauthConfig.apiUrl}${path}`, { ...init, headers })
  } catch {
    throw new ApiError('无法连接到服务，请检查网络后重试')
  }
  if (!response.ok) {
    let message = response.status >= 500 ? '服务暂时不可用，请稍后重试' : `请求失败（${response.status}）`
    try {
      const body = await response.json() as ApiErrorBody
      if (typeof body.detail === 'string') message = body.detail
      else if (Array.isArray(body.detail)) message = body.detail.map((item) => item.msg).filter(Boolean).join('；') || message
      else if (body.detail?.message) message = body.detail.message
    } catch {
      // Keep the HTTP fallback when the service does not return JSON.
    }
    if (response.status === 401) unauthorizedHandler?.()
    throw new ApiError(message, response.status)
  }
  return response.json() as Promise<T>
}

export function getCurrentUser(accessToken: string) {
  return apiRequest<User>('/user/me', { accessToken })
}
