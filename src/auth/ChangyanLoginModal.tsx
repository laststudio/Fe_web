import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ETS100_ORIGIN,
  buildChangyanLoginUrl,
  readPostMessageCredential,
  readTicketCredential,
  resolveDefaultChangyanMode,
  resolveNextpageUrl,
  type ChangyanCredential,
  type ChangyanMode,
} from './changyan'

type ChangyanLoginModalProps = {
  onCredential: (credential: ChangyanCredential) => void
  onClose: () => void
  /** 凭据获取通路，留空则用 resolveDefaultChangyanMode()。 */
  mode?: ChangyanMode
  /** 后端兑换过程中禁用交互。 */
  busy?: boolean
  /** 兑换失败信息。 */
  error?: string | null
}

function symbol(name: string) {
  return (
    <span className="material-symbols-outlined" aria-hidden="true">
      {name}
    </span>
  )
}

/**
 * 内嵌畅言通行证登录页。
 *
 * 用户在 iframe 内正常输入账号密码并完成极验滑块，登录成功后由
 * loginCheck.html（或本站回调页）把凭据交回父页面 —— 全程不需要任何注入。
 *
 * 布局说明见 App.css 中 `.fe-changyan-*`：畅言页是固定桌面布局（容器
 * min-width:780px，左半是背景大图、右半是表单），桌面端给足宽度即可，
 * 移动端则固定 780px 宽并横向平移，加载后自动把表单对齐进屏幕。
 */
export default function ChangyanLoginModal({
  onCredential,
  onClose,
  mode,
  busy = false,
  error = null,
}: ChangyanLoginModalProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const deliveredRef = useRef(false)
  const [loaded, setLoaded] = useState(false)
  const [frameKey, setFrameKey] = useState(0)

  const activeMode = useMemo<ChangyanMode>(() => mode ?? resolveDefaultChangyanMode(), [mode])
  // 重载靠 iframe 的 key 重新挂载，URL 本身不变
  const loginUrl = useMemo(() => buildChangyanLoginUrl(resolveNextpageUrl(activeMode)), [activeMode])

  // 打开期间锁定页面滚动，避免背景跟着滚
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  // Esc 关闭（提交中不响应，避免打断兑换）
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [busy, onClose])

  // 兜底：极端情况下 onLoad 不触发（页面加载失败等）也要收起加载提示，
  // 否则用户会一直以为在加载。遮罩本身已设为 pointer-events:none，不会挡操作。
  useEffect(() => {
    if (loaded) return
    const timer = window.setTimeout(() => setLoaded(true), 12000)
    return () => window.clearTimeout(timer)
  }, [loaded])

  // 通路 1：loginCheck.html 的 window.parent.postMessage
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== ETS100_ORIGIN) return
      const credential = readPostMessageCredential(event.data)
      if (!credential || deliveredRef.current) return
      deliveredRef.current = true
      onCredential(credential)
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [onCredential])

  /**
   * 移动端把横向滚动条拉到底：畅言页 780px 布局里表单占据右半部分
   * （实测卡片 x∈[40,759]、表单面板 x≈400..759），滚到最右正好对齐表单。
   */
  const alignToForm = useCallback(() => {
    const body = bodyRef.current
    if (!body || body.scrollWidth <= body.clientWidth) return
    body.scrollLeft = body.scrollWidth
  }, [])

  function handleFrameLoad() {
    setLoaded(true)
    alignToForm()

    if (activeMode !== 'callback' || deliveredRef.current) return
    const frame = bodyRef.current?.querySelector('iframe')
    try {
      const href = frame?.contentWindow?.location.href
      if (!href) return
      const current = new URL(href)
      if (current.origin !== window.location.origin) return
      const credential = readTicketCredential(current.search)
      if (!credential) return
      deliveredRef.current = true
      onCredential(credential)
    } catch {
      // 跨域读取 location 会抛错，说明还在畅言域内，继续等
    }
  }

  const statusText = error
    ? error
    : busy
      ? '正在建立云端会话，请稍候…'
      : activeMode === 'callback'
        ? '登录成功后会自动返回本页。若页面空白，可点「重新加载」或改用其他通路。'
        : '登录可能需要完成极验滑块；若页面空白，请确认浏览器未拦截第三方 Cookie。'

  return (
    <div
      className="fe-changyan-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="讯飞登录"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div className="fe-changyan-card">
        <header className="fe-changyan-head">
          <div className="fe-changyan-title">
            <span className="fe-changyan-title-icon">{symbol('verified_user')}</span>
            <div>
              <h2>讯飞登录</h2>
              <p>在下方完成 e听说账号登录，凭据将直接用于建立云端会话</p>
            </div>
          </div>
          <button
            type="button"
            className="control-icon-button"
            onClick={onClose}
            disabled={busy}
            aria-label="关闭"
            title="关闭"
          >
            {symbol('close')}
          </button>
        </header>

        <div className="fe-changyan-body" ref={bodyRef}>
          <iframe
            key={frameKey}
            className="fe-changyan-frame"
            title="畅言通行证登录"
            src={loginUrl}
            onLoad={handleFrameLoad}
          />
          {!loaded && (
            <div className="fe-changyan-loading">
              <span className="fe-changyan-spinner" />
              <span>正在加载畅言登录页…</span>
            </div>
          )}
        </div>

        <footer className={`fe-changyan-foot${error ? ' is-error' : ''}`}>
          <span className="fe-changyan-foot-text">{statusText}</span>
          <span className="fe-changyan-actions">
            {error ? (
              <button
                type="button"
                className="control-secondary"
                onClick={() => {
                  deliveredRef.current = false
                  setLoaded(false)
                  setFrameKey((value) => value + 1)
                }}
                disabled={busy}
              >
                {symbol('refresh')} 重新加载
              </button>
            ) : (
              <button type="button" className="control-secondary" onClick={onClose} disabled={busy}>
                关闭
              </button>
            )}
          </span>
        </footer>
      </div>
    </div>
  )
}
