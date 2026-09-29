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
 * 默认通路：固定 `ets100`（借助 loginCheck.html 的官方 postMessage 拿凭据）。
 *
 * ⚠ 为什么不用 `callback`（更安全，后端可自验 CAS 票据）：
 * 畅言只给「已登记为 SSO service」的地址发放票据。实测其第 3 跳结果：
 *   https://www.ets100.com/loginCheck.html  -> 200（登录页）
 *   https://lastudio.cc/changyan-callback.html -> 500
 *   https://fe-web.lastudio.cc/...           -> 500
 *   http://127.0.0.1:5173/...                -> 200
 * 即 **HTTPS + 未登记域名直接 500**，浏览器里带着 SSO cookie 就表现为
 * ERR_TOO_MANY_REDIRECTS。
 *
 * 因此 callback 通路需先由畅言把我们的域名登记为 service 才可用；代码保留
 * （后端 /user/platform-account/changyan 的 service_ticket 分支已测试覆盖），
 * 登记后把这里改回按 `?changyan_mode=callback` 切换即可。
 */
export function resolveDefaultChangyanMode(): ChangyanMode {
  return 'ets100'
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
