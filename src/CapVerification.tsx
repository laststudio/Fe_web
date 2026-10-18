import 'cap-widget'
import { useEffect, useRef, useState } from 'react'
import type { CapErrorEvent, CapSolveEvent, CapWidget } from 'cap-widget'

const CAP_ENDPOINT = 'https://auth.lastudio.cc/cap/f0d2ec6d51/'

export default function CapVerification({
  onError,
  onToken,
}: {
  onError: (message: string) => void
  onToken: (token: string) => void
}) {
  const [displayState, setDisplayState] = useState<'checking' | 'ready' | 'error'>('checking')
  const widgetRef = useRef<CapWidget | null>(null)
  const onTokenRef = useRef(onToken)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onTokenRef.current = onToken
    onErrorRef.current = onError
  })

  useEffect(() => {
    const widget = widgetRef.current
    if (!widget) return

    let lastEmittedToken = ''

    const solve = (event: CapSolveEvent) => {
      if (widget.parentElement?.dataset.capDisplay !== 'ready') return
      const token = event.detail?.token
      if (token && token !== lastEmittedToken) {
        lastEmittedToken = token
        onTokenRef.current(token)
      }
    }
    const error = (event: CapErrorEvent) => {
      lastEmittedToken = ''
      onTokenRef.current('')
      onErrorRef.current(event.detail?.message || '人机验证失败，请重试')
    }
    const reset = () => {
      lastEmittedToken = ''
      onTokenRef.current('')
    }

    // Fail closed when CSP/browser processing prevents the shadow stylesheet
    // from applying. Never leave the unstyled SVG visible as a giant circle.
    const styleCheck = window.requestAnimationFrame(() => {
      const surface = widget.shadowRoot?.querySelector<HTMLElement>('.captcha')
      const circle = widget.shadowRoot?.querySelector('circle')
      const styled = surface && circle
        && getComputedStyle(surface).position === 'relative'
        && getComputedStyle(circle).fill === 'none'
      if (styled) {
        setDisplayState('ready')
      } else {
        setDisplayState('error')
        onTokenRef.current('')
        onErrorRef.current('验证界面加载失败，请刷新页面后重试；若仍异常，请在外部浏览器中打开。')
      }
    })

    widget.addEventListener('solve', solve)
    widget.addEventListener('error', error)
    widget.addEventListener('reset', reset)
    return () => {
      window.cancelAnimationFrame(styleCheck)
      widget.removeEventListener('solve', solve)
      widget.removeEventListener('error', error)
      widget.removeEventListener('reset', reset)
    }
  }, [])

  return (
    <div className="account-captcha" data-cap-display={displayState} aria-busy={displayState === 'checking'}>
      {displayState === 'checking' && <span className="cap-display-message" role="status">正在加载人机验证…</span>}
      {displayState === 'error' && <span className="cap-display-message" role="alert">验证组件未能加载，请刷新页面重试。</span>}
      {displayState !== 'error' && <cap-widget
        data-cap-api-endpoint={CAP_ENDPOINT}
        data-cap-disable-haptics=""
        data-cap-i18n-error-aria-label="人机验证发生错误，请重试"
        data-cap-i18n-error-label="验证失败"
        data-cap-i18n-initial-state="点击开始验证"
        data-cap-i18n-required-label="请完成人机验证"
        data-cap-i18n-solved-label="验证完成"
        data-cap-i18n-verified-aria-label="人机验证已完成"
        data-cap-i18n-verify-aria-label="点击开始人机验证"
        data-cap-i18n-verifying-aria-label="正在进行人机验证"
        data-cap-i18n-verifying-label="正在验证"
        ref={widgetRef}
        required
      />}
    </div>
  )
}
