const transitionDuration = 180
let activityCount = 0
let initialLoad = true
let finishTimer: number | undefined
let transitionPending = false
let queuedRouteUpdate: (() => void) | null = null

export const navigationStatusEvent = 'lastudio:navigation-status'

function announce(message: string) {
  window.dispatchEvent(new CustomEvent(navigationStatusEvent, { detail: message }))
}

function focusRouteHeading() {
  window.requestAnimationFrame(() => {
    const target = document.querySelector<HTMLElement>('main h1, main')
    if (!target) return
    target.tabIndex = -1
    target.focus({ preventScroll: true })
  })
}

export function startLoading() {
  window.clearTimeout(finishTimer)
  document.documentElement.classList.remove('navigation-finishing')
  document.documentElement.classList.add('navigation-loading')
  announce('页面正在切换')
}

export function finishLoading() {
  if (initialLoad || activityCount > 0) return
  document.documentElement.classList.add('navigation-finishing')
  finishTimer = window.setTimeout(() => {
    document.documentElement.classList.remove('navigation-loading', 'navigation-finishing')
    announce('')
  }, 240)
}

export function completeInitialLoad() {
  initialLoad = false
  finishLoading()
}

export function beginNavigationActivity() {
  let finished = false
  activityCount += 1
  startLoading()
  return () => {
    if (finished) return
    finished = true
    activityCount = Math.max(0, activityCount - 1)
    finishLoading()
  }
}

export function transitionTo(href: string, replace = false) {
  if (transitionPending) return
  transitionPending = true
  startLoading()
  document.documentElement.classList.add('navigation-leaving')
  window.setTimeout(() => window.location[replace ? 'replace' : 'assign'](href), transitionDuration)
}

export function transitionRoute(updateRoute: () => void) {
  if (transitionPending) {
    queuedRouteUpdate = updateRoute
    return
  }
  transitionPending = true
  startLoading()
  document.documentElement.classList.add('navigation-leaving')
  window.setTimeout(() => {
    const routeUpdate = queuedRouteUpdate || updateRoute
    queuedRouteUpdate = null
    routeUpdate()
    transitionPending = false
    focusRouteHeading()
    document.documentElement.classList.remove('navigation-leaving')
    document.documentElement.classList.add('navigation-entering')
    window.setTimeout(() => {
      document.documentElement.classList.remove('navigation-entering')
      finishLoading()
    }, 360)
  }, transitionDuration)
}
