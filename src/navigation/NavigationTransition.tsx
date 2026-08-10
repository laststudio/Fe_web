import { useEffect, useState, type ReactNode } from 'react'
import { completeInitialLoad, navigationStatusEvent, transitionTo } from './controller'

function shouldHandleLink(event: MouseEvent, anchor: HTMLAnchorElement) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
  if (anchor.target && anchor.target !== '_self') return false
  if (anchor.hasAttribute('download')) return false
  const url = new URL(anchor.href, window.location.href)
  if (!/^https?:$/.test(url.protocol)) return false
  return !(url.origin === window.location.origin && url.pathname === window.location.pathname && url.search === window.location.search && url.hash)
}

export default function NavigationTransition({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState('')

  useEffect(() => {
    const root = document.documentElement
    root.classList.add('navigation-loading', 'navigation-entering')
    const enterTimer = window.setTimeout(() => root.classList.remove('navigation-entering'), 360)
    const loadTimer = window.setTimeout(completeInitialLoad, 440)
    const onClick = (event: MouseEvent) => {
      const target = event.target
      const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null
      if (!anchor || !shouldHandleLink(event, anchor)) return
      event.preventDefault()
      transitionTo(anchor.href)
    }
    const onStatus = (event: Event) => setStatus((event as CustomEvent<string>).detail)
    document.addEventListener('click', onClick)
    window.addEventListener(navigationStatusEvent, onStatus)
    return () => {
      window.clearTimeout(enterTimer)
      window.clearTimeout(loadTimer)
      document.removeEventListener('click', onClick)
      window.removeEventListener(navigationStatusEvent, onStatus)
    }
  }, [])

  return <><div className="navigation-progress" aria-hidden="true"><i /></div><div className="navigation-stage">{children}</div>{status ? <span className="navigation-status" role="status" aria-live="polite">{status}</span> : null}</>
}
