const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

export type User = {
  id: number
  name: string
  role: number
  member_level: number
  created_by: number | null
  create_time?: string
}

export type AuthSession = {
  accessToken: string
  tokenType: string
  user: User
}

type LoginResponse = {
  message: string
  user_id: number
  username: string
  role: number
  member_level: number
  access_token: string
  token_type: string
}

export type CaptchaPurpose = 'login' | 'register'

export type CaptchaChallenge = {
  captchaId: string
  imageUrl: string
  expiresAt: string
}

export type Membership = {
  user_id: number
  member_level: number
  expire_time: string | null
}

export type FeNotice = {
  isForce: boolean
  isKillSwitchOn: boolean
  noticeMessage: string
  announcementTitle: string
  announcementMessage: string
  announcementUrl: string
  changelogTitle: string
  changelogUrl: string
  changelogSummary: string
  verificationCode: string
  verificationTitle: string
  verificationMessage: string
  donateEnabled: boolean
  latestVersionCode: number
  updateUrl: string
  updateMessage: string
}

type CaptchaChallengeResponse = {
  captcha_id: string
  image_url: string
  expires_at: string
}

type ApiErrorBody = {
  detail?: string | { msg?: string }[] | {
    code?: string
    message?: string
    captcha_required?: boolean
  }
}

export class ApiError extends Error {
  status: number
  code?: string
  captchaRequired: boolean

  constructor(message: string, status = 0, options?: { code?: string; captchaRequired?: boolean }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = options?.code
    this.captchaRequired = options?.captchaRequired ?? false
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${apiBaseUrl}${path}`, init)
  } catch {
    throw new ApiError('无法连接到服务，请检查网络后重试')
  }

  if (!response.ok) {
    let message = response.status >= 500 ? '服务暂时不可用，请稍后重试' : `请求失败（${response.status}）`
    let code: string | undefined
    let captchaRequired = false

    try {
      const body = (await response.json()) as ApiErrorBody
      if (typeof body.detail === 'string') {
        message = body.detail
      } else if (Array.isArray(body.detail)) {
        message = body.detail.map((item) => item.msg).filter(Boolean).join('；') || message
      } else if (body.detail) {
        message = body.detail.message || message
        code = body.detail.code
        captchaRequired = body.detail.captcha_required === true
      }
    } catch {
      // Keep the HTTP fallback when the server does not return JSON.
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After')
      if (retryAfter) {
        message = `${message}（约 ${retryAfter} 秒）`
      }
    }

    throw new ApiError(message, response.status, { code, captchaRequired })
  }

  return response.json() as Promise<T>
}

export async function createCaptcha(purpose: CaptchaPurpose): Promise<CaptchaChallenge> {
  const result = await apiRequest<CaptchaChallengeResponse>(`/auth/captcha?purpose=${purpose}`, {
    method: 'POST',
  })

  return {
    captchaId: result.captcha_id,
    imageUrl: `${apiBaseUrl}${result.image_url}`,
    expiresAt: result.expires_at,
  }
}

export async function login(
  username: string,
  password: string,
  captcha?: { id: string; answer: string },
): Promise<AuthSession> {
  const form = new URLSearchParams({ username, password })
  if (captcha) {
    form.set('captcha_id', captcha.id)
    form.set('captcha_answer', captcha.answer)
  }
  const result = await apiRequest<LoginResponse>('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  })

  return {
    accessToken: result.access_token,
    tokenType: result.token_type,
    user: {
      id: result.user_id,
      name: result.username,
      role: result.role,
      member_level: result.member_level,
      created_by: null,
    },
  }
}

export async function register(
  username: string,
  password: string,
  confirmPassword: string,
  captcha: { id: string; answer: string },
): Promise<User> {
  return apiRequest<User>('/user/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      passwd: password,
      passwd2: confirmPassword,
      captcha_id: captcha.id,
      captcha_answer: captcha.answer,
    }),
  })
}

export async function getCurrentUser(accessToken: string): Promise<User> {
  return apiRequest<User>('/user/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

export async function getMembership(accessToken: string): Promise<Membership> {
  return apiRequest<Membership>('/user/membership', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

export async function redeemCard(accessToken: string, code: string): Promise<{
  message: string
  member_level: number
  expire_time: string
}> {
  return apiRequest<{ message: string; member_level: number; expire_time: string }>('/user/cards/redeem', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code }),
  })
}

export async function changeMyPassword(
  accessToken: string,
  oldPassword: string,
  newPassword: string,
  confirmPassword: string,
): Promise<{ status: string }> {
  return apiRequest<{ status: string }>('/user/change_my_password', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      old_passwd: oldPassword,
      new_passwd: newPassword,
      new_passwd2: confirmPassword,
    }),
  })
}

export async function getFeNotice(): Promise<FeNotice> {
  return apiRequest<FeNotice>('/notice/Fe')
}
