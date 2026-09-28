import { useEffect, useMemo, useRef, useState } from 'react'
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

/**
 * 内嵌畅言通行证登录页。
 *
 * 用户在 iframe 内正常输入账号密码并完成极验滑块，登录成功后由
 * loginCheck.html（或本站回调页）把凭据交回父页面 —— 全程不需要任何注入。
 */
export default function ChangyanLoginModal({
  onCredential,
  onClose,
  mode,
  busy = false,
  error = null,
}: ChangyanLoginModalProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const deliveredRef = useRef(false)
  const [loaded, setLoaded] = useState(false)

  const activeMode = useMemo<ChangyanMode>(() => mode ?? resolveDefaultChangyanMode(), [mode])
  const loginUrl = useMemo(() => buildChangyanLoginUrl(resolveNextpageUrl(activeMode)), [activeMode])

  useEffect(() => {
    deliveredRef.current = false
  }, [loginUrl])

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

  // 通路 2：nextpage 指向本站回调页，同源读取查询串里的 CAS 票据
  function handleFrameLoad() {
    setLoaded(true)
    const frame = iframeRef.current
    if (!frame || activeMode !== 'callback' || deliveredRef.current) return
    try {
      const href = frame.contentWindow?.location.href
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="讯飞登录"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15, 23, 42, 0.55)',
        padding: 16,
      }}
    >
      <div
        className="fe-card"
        style={{
          width: 'min(560px, 100%)',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface, #fff)',
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(15, 23, 42, 0.28)',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px 16px',
            borderBottom: '1px solid var(--control-border, #e2e8f0)',
          }}
        >
          <div>
            <strong style={{ fontSize: 15 }}>讯飞登录</strong>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--control-muted, #64748b)' }}>
              在下方完成 ETS100 账号登录，凭据将直接用于建立云端会话
            </p>
          </div>
          <button
            type="button"
            className="control-ghost"
            onClick={onClose}
            disabled={busy}
            style={{ flexShrink: 0 }}
          >
            关闭
          </button>
        </header>

        <div style={{ position: 'relative', flex: 1, minHeight: 420, background: '#fff' }}>
          <iframe
            ref={iframeRef}
            title="畅言通行证登录"
            src={loginUrl}
            onLoad={handleFrameLoad}
            style={{ width: '100%', height: '100%', minHeight: 420, border: 0, display: 'block' }}
          />
          {!loaded && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--control-muted, #64748b)',
                fontSize: 13,
                pointerEvents: 'none',
              }}
            >
              正在加载畅言登录页…
            </div>
          )}
        </div>

        <footer
          style={{
            padding: '10px 16px 14px',
            fontSize: 12,
            color: 'var(--control-muted, #64748b)',
            borderTop: '1px solid var(--control-border, #e2e8f0)',
          }}
        >
          {error ? (
            <span style={{ color: '#b91c1c' }}>{error}</span>
          ) : busy ? (
            <span>正在建立云端会话，请稍候…</span>
          ) : (
            <span>
              登录可能需要完成极验滑块；若页面空白，请确认浏览器未拦截第三方 Cookie。
            </span>
          )}
        </footer>
      </div>
    </div>
  )
}
