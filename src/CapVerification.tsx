import 'cap-widget'
import { useEffect, useRef } from 'react'
import type { CapErrorEvent, CapSolveEvent, CapWidget } from 'cap-widget'

const CAP_ENDPOINT = 'https://auth.lastudio.cc/cap/f0d2ec6d51/'

export default function CapVerification({
  onError,
  onToken,
}: {
  onError: (message: string) => void
  onToken: (token: string) => void
}) {
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

    widget.addEventListener('solve', solve)
    widget.addEventListener('error', error)
    widget.addEventListener('reset', reset)
    return () => {
      widget.removeEventListener('solve', solve)
      widget.removeEventListener('error', error)
      widget.removeEventListener('reset', reset)
    }
  }, [])

  return (
    <div className="account-captcha">
      <cap-widget
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
      />
    </div>
  )
}
