import { oauthConfig } from '../auth/config'

export type User = {
  id: number
  name: string
  role: number
  member_level: number
  avatar_url?: string | null
}

export type ApiErrorInfo = {
  status: number
  code?: string
  reason?: 'membership_required' | 'feature_disabled' | 'kill_switch' | 'software_disabled' | 'network_error' | 'rate_limited' | 'unauthorized' | string
  featureKey?: string
  minMemberLevel?: number
  captchaRequired?: boolean
  isNetworkError?: boolean
}

export class ApiError extends Error {
  status: number
  code?: string
  reason?: string
  featureKey?: string
  minMemberLevel?: number
  captchaRequired?: boolean
  isNetworkError?: boolean

  constructor(message: string, status = 0, infoOrCaptcha: boolean | Partial<ApiErrorInfo> = false) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    if (typeof infoOrCaptcha === 'boolean') {
      this.captchaRequired = infoOrCaptcha
    } else if (infoOrCaptcha) {
      this.captchaRequired = infoOrCaptcha.captchaRequired
      this.code = infoOrCaptcha.code
      this.reason = infoOrCaptcha.reason
      this.featureKey = infoOrCaptcha.featureKey
      this.minMemberLevel = infoOrCaptcha.minMemberLevel
      this.isNetworkError = infoOrCaptcha.isNetworkError
    }
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
    throw new ApiError('网络连接失败，请检查您的网络连接是否正常', 0, {
      isNetworkError: true,
      reason: 'network_error',
    })
  }

  if (!response.ok) {
    const errorReasonHeader = response.headers.get('X-Error-Reason')
    const featureKeyHeader = response.headers.get('X-Feature-Key')
    const minLevelHeader = response.headers.get('X-Min-Member-Level')

    let message = response.status >= 500 ? '服务暂时不可用，请稍后重试' : `请求失败（${response.status}）`
    let captchaRequired = false
    let code: string | undefined
    let reason: string | undefined = errorReasonHeader || undefined
    let featureKey: string | undefined = featureKeyHeader || undefined
    let minMemberLevel: number | undefined = minLevelHeader ? parseInt(minLevelHeader, 10) : undefined

    try {
      const body = (await response.json()) as {
        detail?: string | { msg?: string }[] | {
          message?: string
          captcha_required?: boolean
          code?: string
          reason?: string
          feature_key?: string
          min_member_level?: number
        }
        captcha_required?: boolean
        code?: string
        reason?: string
        feature_key?: string
        min_member_level?: number
      }

      if (typeof body.detail === 'string') {
        message = body.detail
      } else if (Array.isArray(body.detail)) {
        message = body.detail.map((item) => item.msg).filter(Boolean).join('；') || message
      } else if (body.detail && typeof body.detail === 'object') {
        if (body.detail.message) message = body.detail.message
        if (body.detail.captcha_required) captchaRequired = true
        if (body.detail.code) code = body.detail.code
        if (body.detail.reason) reason = body.detail.reason
        if (body.detail.feature_key) featureKey = body.detail.feature_key
        if (body.detail.min_member_level) minMemberLevel = body.detail.min_member_level
      }
      if (body.captcha_required) captchaRequired = true
      if (body.code) code = body.code
      if (body.reason) reason = body.reason
      if (body.feature_key) featureKey = body.feature_key
      if (body.min_member_level) minMemberLevel = body.min_member_level
    } catch {
      // Keep the HTTP fallback when the service does not return JSON.
    }

    // Heuristics classification if not explicitly given
    if (!reason) {
      if (response.status === 403) {
        if (message.includes('会员') || message.includes('VIP')) {
          reason = 'membership_required'
        } else if (message.includes('停用') || message.includes('禁用') || message.includes('不可用')) {
          reason = 'feature_disabled'
        }
      } else if (response.status === 503) {
        if (message.includes('维护') || message.includes('紧急停用')) {
          reason = 'kill_switch'
        } else {
          reason = 'software_disabled'
        }
      } else if (response.status === 429) {
        reason = 'rate_limited'
      }
    }

    if (response.status === 401) unauthorizedHandler?.()
    if (response.status === 429 && !captchaRequired) {
      captchaRequired = true
    }

    throw new ApiError(message, response.status, {
      captchaRequired,
      code,
      reason,
      featureKey,
      minMemberLevel,
      isNetworkError: false,
    })
  }
  return response.json() as Promise<T>
}

export function getCurrentUser(accessToken: string) {
  return apiRequest<User>('/user/me', { accessToken })
}
