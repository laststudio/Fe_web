/**
 * 畅言网页登录（讯飞登录）—— 浏览器端凭据获取
 *
 * Android 端靠 WebView 注入 `$(document).ajaxComplete` 读 `/login/checkLogin`
 * 的响应；浏览器受同源策略限制读不到那个跨域 XHR，因此这里改用官方提供的两条
 * 无注入通路：
 *
 * 1. `ets100` 模式：`nextpage` 指向 `https://www.ets100.com/loginCheck.html`，
 *    该页登录成功后会 `window.parent.postMessage({userId, loginName, token}, '*')`
 *    （见 loginCheck.js），我们在父页面收消息即可。
 * 2. `callback` 模式：`nextpage` 指向本站的静态回调页，畅言登录后 302 回来并
 *    在查询串带上 CAS 票据（`st` / `service`）。因同源，父页面可直接读取。
 *
 * 两条通路拿到的凭据形态不同，后端 `/homework/changyan-login` 两种都接受。
 */

export type ChangyanPostMessageCredential = {
  login: string
  user_id: string
  suc_user_token: string
}

export type ChangyanTicketCredential = {
  service_ticket: string
  service: string
}

export type ChangyanCredential = ChangyanPostMessageCredential | ChangyanTicketCredential

export type ChangyanMode = 'ets100' | 'callback'

export const CHANGYAN_PASSPORT_ORIGIN = 'https://pass.changyan.com'
export const ETS100_ORIGIN = 'https://www.ets100.com'
export const ETS100_LOGIN_CHECK_URL = `${ETS100_ORIGIN}/loginCheck.html`
export const CHANGYAN_CALLBACK_PATH = '/changyan-callback.html'

const APP_ID = 'pass6port18'

/**
 * 与原 Android 端 `ChangyanWebLoginActivity.LOGIN_URL` 完全一致：
 * view_type=WEB、隐藏页头页尾/验证码登录/注册/第三方登录、需要 ticket。
 */
const CUSTOM_CONFIG =
  'e3ZpZXdfdHlwZToiV0VCIixoaWRkZW5fbW9kdWxlOiAiaGVhZGVyLHRhaWwsbG9naW5CeVZlcmlmeUNvZGUs' +
  'IHJlZ2lzdGVyLGxvZ2luQnlUaGlyZExvZ2luIixwcm9kdWN0X2FwcGtleTogInFpbmdkYW9fZXRzIiwibmVl' +
  'ZFRpY2tldCI6ICJ0cnVlIiwibG9naW5fbm90QXV0byI6ICJ0cnVlIn0='

/** 与后端 `ets100.CHANGYAN_SSO_BASE_URL` 对应，仅用于提示文案。 */
export const CHANGYAN_APP_ID = APP_ID

function base64Encode(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function buildChangyanLoginUrl(nextpageUrl: string): string {
  const params = new URLSearchParams({
    nextpage: base64Encode(nextpageUrl),
    customConfig: CUSTOM_CONFIG,
    from: 'ew',
    appId: APP_ID,
  })
  return `${CHANGYAN_PASSPORT_ORIGIN}/login?${params.toString()}`
}

export function changyanCallbackUrl(): string {
  return `${window.location.origin}${CHANGYAN_CALLBACK_PATH}`
}

export function resolveNextpageUrl(mode: ChangyanMode): string {
  return mode === 'callback' ? changyanCallbackUrl() : ETS100_LOGIN_CHECK_URL
}

/**
 * 默认通路。
 *
 * `ets100`：已实测可用 —— 借助 loginCheck.html 的官方 postMessage 拿凭据。
 * `callback`：更安全（后端可用 CAS 票据自验身份），但需要畅言把 `st` 回跳到本站域名，
 *             尚未验证，因此暂不做默认。
 *
 * 现网验证时不必改代码：带 `?changyan_mode=callback` 打开站点即可切换。
 */
export function resolveDefaultChangyanMode(search?: string): ChangyanMode {
  const query = search ?? (typeof window === 'undefined' ? '' : window.location.search)
  const value = new URLSearchParams(query).get('changyan_mode')
  return value === 'callback' ? 'callback' : 'ets100'
}

/** 判定 loginCheck.html 通过 postMessage 回传的载荷。 */
export function readPostMessageCredential(data: unknown): ChangyanPostMessageCredential | null {
  if (!data || typeof data !== 'object') return null
  const payload = data as Record<string, unknown>
  const login = typeof payload.loginName === 'string' ? payload.loginName.trim() : ''
  const userId = typeof payload.userId === 'string' ? payload.userId.trim() : ''
  const token = typeof payload.token === 'string' ? payload.token.trim() : ''
  if (!login || !userId) return null
  return { login, user_id: userId, suc_user_token: token }
}

/** 从回调页的查询串里取出 CAS 票据。 */
export function readTicketCredential(search: string): ChangyanTicketCredential | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const ticket = (params.get('st') || params.get('ticket') || '').trim()
  const service = (params.get('service') || '').trim()
  if (!ticket) return null
  return { service_ticket: ticket, service: service || changyanCallbackUrl() }
}
